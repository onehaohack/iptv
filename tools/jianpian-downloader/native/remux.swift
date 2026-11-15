// 把 HLS 拼接出来的 MPEG-TS 转封装成 MP4。
//
// 为什么不用 avconvert：这些线路的流里会**夹广告**——广告段是 1920x1080 的
// 16:9，正片是 1920x960 的 2:1。同一条 TS 里分辨率中途变了，MP4 一条轨道
// 只能有一个 SPS，所以 AVAssetExportSession 直接以 -11800 / -16364 失败。
//
// 这里的做法：
//   1. 扫一遍视频采样，按分辨率统计，出现次数最多的是正片，其余当成广告插播；
//   2. 算出这些插播的【源时间区间】，并延伸到下一个关键帧，避免断在 GOP 中间；
//   3. 第二遍做直通转封装，跳过这些区间，后面的时间轴整体前移，
//      播放时是连贯的（相当于把广告剪掉），音轨按同样的区间裁剪，音画不会错位。
//   不重编码，画质零损失，速度接近直接拷贝。
//
// 用法：remux <input.ts> <output.mp4>
// 成功：stdout 输出 "OK <字节数> dropped=<秒>"，退出码 0
// 失败：stderr 输出原因，退出码 1

import AVFoundation
import Foundation

func die(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

func debugLog(_ message: String) {
  guard ProcessInfo.processInfo.environment["REMUX_DEBUG"] != nil else { return }
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
}

let args = CommandLine.arguments
guard args.count >= 3 else { die("usage: remux <input> <output>") }

let inputURL = URL(fileURLWithPath: args[1])
let outputURL = URL(fileURLWithPath: args[2])

guard FileManager.default.fileExists(atPath: inputURL.path) else {
  die("输入文件不存在：\(inputURL.path)")
}
try? FileManager.default.removeItem(at: outputURL)

let asset = AVURLAsset(url: inputURL)

guard let videoTrack = asset.tracks(withMediaType: .video).first else {
  die("没有视频轨道")
}
let audioTrack = asset.tracks(withMediaType: .audio).first

func isSync(_ sample: CMSampleBuffer) -> Bool {
  guard let raw = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) else {
    return true
  }
  let attachments = raw as NSArray
  guard let first = attachments.firstObject as? [CFString: Any] else { return true }
  return !(first[kCMSampleAttachmentKey_NotSync] as? Bool ?? false)
}

// MARK: - 第一遍：按分辨率找广告插播区间

struct VideoProbe {
  var key: String
  var pts: Double
  var sync: Bool
}

var probes: [VideoProbe] = []
var dimCounts: [String: Int] = [:]

do {
  let reader = try AVAssetReader(asset: asset)
  let output = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: nil)
  output.alwaysCopiesSampleData = false
  reader.add(output)
  guard reader.startReading() else {
    die("扫描失败：\(reader.error?.localizedDescription ?? "unknown")")
  }

  var scanned = 0
  while let sample = output.copyNextSampleBuffer() {
    let pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
    guard pts.isFinite else { continue }
    guard let fmt = CMSampleBufferGetFormatDescription(sample) else { continue }
    let dims = CMVideoFormatDescriptionGetDimensions(fmt)
    let key = "\(dims.width)x\(dims.height)"
    dimCounts[key, default: 0] += 1
    probes.append(VideoProbe(key: key, pts: pts, sync: isSync(sample)))
    scanned += 1
  }

  guard scanned > 0 else { die("扫描不到视频采样：\(reader.error?.localizedDescription ?? "unknown")") }
  debugLog("debug: scanned \(scanned) samples, dims=\(dimCounts)")
}

// 出现最多的分辨率是正片（防止文件开头就是广告时判反）
guard let keepKey = dimCounts.max(by: { $0.value < $1.value })?.key else { die("没有视频采样") }
debugLog("debug: keep=\(keepKey)")

struct Interval {
  var start: Double
  var end: Double
}

var drops: [Interval] = []
var current: Interval? = nil
var awaitingSync = false

func closeCurrent() {
  if let run = current { drops.append(run) }
  current = nil
}

for probe in probes {
  let matches = probe.key == keepKey
  if !matches {
    // 广告段：开一段（或延续）
    if current == nil {
      current = Interval(start: probe.pts, end: probe.pts)
    }
    current!.end = max(current!.end, probe.pts)
    awaitingSync = true
  } else if awaitingSync {
    // 正片回来了，但要等到关键帧才能接，否则开头会花屏
    if probe.sync {
      closeCurrent()
      awaitingSync = false
    } else {
      current!.end = max(current!.end, probe.pts)
    }
  }
}
closeCurrent()

// 合并挨得很近的区间，避免细碎的剪切
var merged: [Interval] = []
let MERGE_GAP = 0.5
for run in drops {
  if var last = merged.last, run.start - last.end <= MERGE_GAP {
    last.end = max(last.end, run.end)
    merged[merged.count - 1] = last
  } else {
    merged.append(run)
  }
}

if merged.isEmpty {
  debugLog("debug: 没有插播段，整段直通")
} else {
  debugLog("debug: 需要剪掉 \(merged.count) 段：\(merged.map { String(format: "%.1f-%.1f", $0.start, $0.end) }.joined(separator: ", "))")
}

// 区间查询：某时间点是否被剪、剪之前累计剪掉多少秒
func dropOffset(at time: Double) -> (dropped: Bool, shift: Double) {
  var acc = 0.0
  for run in merged {
    if time < run.start { return (false, acc) }
    if time <= run.end { return (true, acc) }
    acc += run.end - run.start
  }
  return (false, acc)
}

// 预期要写入的视频采样数：总采样减去落在广告区间里的
var expectedVideo = 0
for probe in probes {
  if !dropOffset(at: probe.pts).dropped { expectedVideo += 1 }
}
debugLog("debug: 预期视频采样 \(expectedVideo)（总 \(probes.count)）")

// MARK: - 第二遍：直通转封装

let writer: AVAssetWriter
do {
  writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
} catch {
  die("创建 writer 失败：\(error.localizedDescription)")
}
writer.shouldOptimizeForNetworkUse = true

struct TrackJob {
  let input: AVAssetWriterInput
  let reader: AVAssetReader
  let output: AVAssetReaderTrackOutput
}
var pairs: [TrackJob] = []

// 每条轨道用独立 reader：同一个 reader 上挂两个 output 再并发读，
// 实测会让 reader 随机报 -11800（读视频的同时读音频就会崩）。
for (mediaType, track) in [(AVMediaType.video, videoTrack), (AVMediaType.audio, audioTrack)] {
  guard let track = track else { continue }
  guard let raw = track.formatDescriptions.first else {
    if mediaType == .audio { continue }
    die("视频轨道缺少格式描述")
  }
  let hint = raw as! CMFormatDescription

  let trackReader: AVAssetReader
  do {
    trackReader = try AVAssetReader(asset: asset)
  } catch {
    die("创建 reader 失败：\(error.localizedDescription)")
  }
  let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
  output.alwaysCopiesSampleData = true
  guard trackReader.canAdd(output) else { continue }
  trackReader.add(output)

  let input = AVAssetWriterInput(mediaType: mediaType, outputSettings: nil, sourceFormatHint: hint)
  input.expectsMediaDataInRealTime = false
  guard writer.canAdd(input) else { die("writer 不接受 \(mediaType.rawValue) 轨道") }
  writer.add(input)

  pairs.append(TrackJob(input: input, reader: trackReader, output: output))
}

guard !pairs.isEmpty else { die("没有可用的轨道") }

guard writer.startWriting() else {
  die("startWriting 失败：\(writer.error?.localizedDescription ?? "unknown")")
}
for job in pairs {
  guard job.reader.startReading() else {
    die("startReading 失败：\(job.reader.error?.localizedDescription ?? "unknown")")
  }
}

// 预读一小段，用其中最早的时间戳当 0 点（TS 开头常有空采样和负 DTS）
let PROLOGUE = 120
var prologues: [Int: [CMSampleBuffer]] = [:]
var baseSeconds = Double.infinity

func note(_ t: CMTime) {
  guard t.isValid, t.isNumeric else { return }
  let s = CMTimeGetSeconds(t)
  guard s.isFinite else { return }
  if s < baseSeconds { baseSeconds = s }
}

for (index, pair) in pairs.enumerated() {
  var buffer: [CMSampleBuffer] = []
  while buffer.count < PROLOGUE, let sample = pair.output.copyNextSampleBuffer() {
    buffer.append(sample)
    let pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
    guard pts.isFinite else { continue }
    if dropOffset(at: pts).dropped { continue }
    note(CMSampleBufferGetPresentationTimeStamp(sample))
    note(CMSampleBufferGetDecodeTimeStamp(sample))
  }
  guard !buffer.isEmpty else {
    die("读不到 \(pair.input.mediaType.rawValue) 采样：\(pair.reader.error?.localizedDescription ?? "unknown")")
  }
  prologues[index] = buffer
}

guard baseSeconds.isFinite else { die("读不到有效时间戳") }
let base = CMTime(seconds: baseSeconds, preferredTimescale: 600)
debugLog("debug: base=\(baseSeconds)")

writer.startSession(atSourceTime: .zero)

struct TrackClock {
  var lastBase: CMTime = .invalid
  var lastDuration: CMTime = .invalid
  var repairs: Int = 0
  var skipped: Int = 0
}

// 把源时间换算成输出时间：减去 0 点，再减掉前面剪掉的广告时长。
// 注意绝不能强行让 PTS 单调——B 帧的显示顺序本来就乱。
func retime(_ sample: CMSampleBuffer, clock: inout TrackClock) -> CMSampleBuffer? {
  let count = CMSampleBufferGetNumSamples(sample)
  guard count > 0 else { return nil }
  guard CMSampleBufferGetPresentationTimeStamp(sample).isNumeric else { return nil }

  var timing = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: count)
  var needed: CMItemCount = 0
  let status = CMSampleBufferGetSampleTimingInfoArray(
    sample, entryCount: count, arrayToFill: &timing, entriesNeededOut: &needed)
  guard status == noErr else { return nil }

  for i in 0..<count {
    let rawPTS = timing[i].presentationTimeStamp
    let rawDTS = timing[i].decodeTimeStamp
    let srcSeconds = CMTimeGetSeconds(rawPTS)
    guard srcSeconds.isFinite else { return nil }

    let cut = dropOffset(at: srcSeconds)
    if cut.dropped { return nil }

    var duration = timing[i].duration
    if !duration.isValid || duration <= .zero {
      duration = clock.lastDuration.isValid ? clock.lastDuration : CMTime(value: 1, timescale: 600)
    }

    let shift = CMTime(seconds: cut.shift, preferredTimescale: 600)
    var pts = CMTimeSubtract(CMTimeSubtract(rawPTS, base), shift)
    var dts: CMTime = .invalid
    if rawDTS.isValid {
      dts = CMTimeSubtract(CMTimeSubtract(rawDTS, base), shift)
    }

    let monotonicBase = dts.isValid ? dts : pts
    if clock.lastBase.isValid && monotonicBase < clock.lastBase {
      // 兜底：分段边界残留下来的倒退，往前挪一点点
      let target = CMTimeAdd(clock.lastBase, clock.lastDuration)
      let delta = CMTimeSubtract(target, monotonicBase)
      pts = CMTimeAdd(pts, delta)
      if dts.isValid { dts = CMTimeAdd(dts, delta) }
      clock.repairs += 1
    }

    timing[i].presentationTimeStamp = pts
    timing[i].decodeTimeStamp = dts
    timing[i].duration = duration

    clock.lastBase = dts.isValid ? dts : pts
    clock.lastDuration = duration
  }

  var out: CMSampleBuffer?
  let err = CMSampleBufferCreateCopyWithNewTiming(
    allocator: kCFAllocatorDefault,
    sampleBuffer: sample,
    sampleTimingEntryCount: count,
    sampleTimingArray: &timing,
    sampleBufferOut: &out)
  guard err == noErr else { return nil }
  return out
}

let lock = NSLock()
var appendError: String? = nil
var appendedCounts: [String: Int] = [:]
let group = DispatchGroup()

for (index, job) in pairs.enumerated() {
  let input = job.input
  let output = job.output
  let pending = prologues[index] ?? []
  var pendingIndex = 0
  let queue = DispatchQueue(label: "remux.track.\(index)")
  group.enter()
  queue.async {
    var clock = TrackClock()
    var appended = 0

    while true {
      lock.lock()
      let failedAlready = appendError != nil
      lock.unlock()
      if failedAlready { break }
      if writer.status != .writing {
        lock.lock()
        if appendError == nil {
          var detail = "writer 提前结束(\(writer.status.rawValue))"
          if let e = writer.error as NSError? { detail += " [\(e.domain) \(e.code)]" }
          appendError = detail
        }
        lock.unlock()
        break
      }

      if !input.isReadyForMoreMediaData {
        Thread.sleep(forTimeInterval: 0.005)
        continue
      }

      let sample: CMSampleBuffer?
      if pendingIndex < pending.count {
        sample = pending[pendingIndex]
        pendingIndex += 1
      } else {
        sample = output.copyNextSampleBuffer()
      }

      guard let sample = sample else {
        if job.reader.status == .failed {
          lock.lock()
          appendError = "读取采样失败：\(job.reader.error?.localizedDescription ?? "unknown")"
          lock.unlock()
        }
        break
      }

      guard let fixed = retime(sample, clock: &clock) else {
        clock.skipped += 1 // 广告段，按计划丢掉
        continue
      }
      appended += 1
      if !input.append(fixed) {
        lock.lock()
        var detail = writer.error?.localizedDescription ?? "unknown"
        if let e = writer.error as NSError? {
          detail += " [\(e.domain) \(e.code)]"
          if let u = e.userInfo[NSUnderlyingErrorKey] as? NSError { detail += " <\(u.code)>" }
        }
        appendError = "写入采样失败：\(detail) \(input.mediaType.rawValue) pts=\(CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)))"
        lock.unlock()
        break
      }
    }

    debugLog("debug: track \(input.mediaType.rawValue) appended=\(appended) skipped=\(clock.skipped) repairs=\(clock.repairs)")
    lock.lock()
    appendedCounts[input.mediaType.rawValue] = appended
    lock.unlock()
    input.markAsFinished()
    group.leave()
  }
}

group.wait()

var fatalError: String? = appendError
if let err = appendError {
  // TS 尾部经常是残缺的分片，demuxer 会在最后几个采样上报错。
  // 只要视频采样数基本齐了，就按“截掉一个尾巴”处理，不整集作废。
  let gotVideo = appendedCounts[AVMediaType.video.rawValue] ?? 0
  let tolerance = Double(expectedVideo) * 0.995
  if err.hasPrefix("读取采样失败") && Double(gotVideo) >= tolerance {
    debugLog("debug: 尾部读取失败，但已写入 \(gotVideo)/\(expectedVideo) 个采样，按截尾处理：\(err)")
    fatalError = nil
  }
}
if let fatalError = fatalError {
  writer.cancelWriting()
  try? FileManager.default.removeItem(at: outputURL)
  die(fatalError)
}

let finishSem = DispatchSemaphore(value: 0)
writer.finishWriting { finishSem.signal() }
finishSem.wait()

guard writer.status == .completed else {
  var reason = writer.error?.localizedDescription ?? "unknown"
  if let e = writer.error as NSError? {
    reason += " [\(e.domain) \(e.code)]"
    if let underlying = e.userInfo[NSUnderlyingErrorKey] as? NSError {
      reason += " <\(underlying.domain) \(underlying.code)>"
    }
  }
  try? FileManager.default.removeItem(at: outputURL)
  die("finishWriting 失败：\(reason)")
}

let attrs = try? FileManager.default.attributesOfItem(atPath: outputURL.path)
let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
let droppedSeconds = merged.reduce(0) { $0 + ($1.end - $1.start) }
print("OK \(size) dropped=\(String(format: "%.1f", droppedSeconds))")
