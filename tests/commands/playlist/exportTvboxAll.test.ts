import { pathToFileURL } from 'node:url'
import { execSync } from 'child_process'
import fs from 'fs-extra'

beforeEach(() => {
  fs.emptyDirSync('tests/__data__/output')
  fs.ensureDirSync('tests/__data__/output/streams')
  fs.ensureDirSync('tests/__data__/output/tvbox/app/src/main/assets')
})

describe('playlist:export:tvbox', () => {
  it('exports English BBC/CNN and China channels only', () => {
    fs.writeFileSync(
      pathToFileURL('tests/__data__/output/streams/us.m3u'),
      [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="BBCNews.uk@NorthAmerica",BBC News North America (720p)',
        'https://example.com/bbc-news.m3u8',
        '#EXTINF:-1 tvg-id="BBCAlba.uk@SD",BBC Alba (1080p)',
        'https://example.com/bbc-alba.m3u8',
        '#EXTINF:-1 tvg-id="BBCFour.uk@UK",BBC Four HD (1080p) (HEVC)',
        'https://example.com/bbc-four-hevc.m3u8',
        '#EXTINF:-1 tvg-id="BBCDrama.uk@Spain",BBC Drama (1080p) [Geo-blocked]',
        'https://example.com/bbc-drama-geoblocked.m3u8',
        '#EXTINF:-1 tvg-id="",BBC Top Gear Germany (1080p)',
        'https://example.com/bbc-top-gear-germany.m3u8',
        '#EXTINF:-1 tvg-id="CNN.us@SD",CNN Headlines International',
        'https://example.com/cnn-headlines.m3u8',
        '#EXTINF:-1 tvg-id="CNNNoticias.us@SD",CNN Noticias',
        'https://example.com/cnn-noticias.m3u8',
        '#EXTINF:-1 tvg-id="News.us@HD",US News (720p)',
        'https://example.com/us-news.m3u8'
      ].join('\n')
    )
    fs.writeFileSync(
      pathToFileURL('tests/__data__/output/streams/cn.m3u'),
      [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="China.cn@HD",China Channel (1080p)',
        'https://example.cn/china.m3u8',
        '#EXTINF:-1 tvg-id="Aggregator.cn@HD",Aggregator Channel',
        'http://epg.112114.xyz/douyu/4332'
      ].join('\n')
    )
    fs.writeFileSync(
      pathToFileURL('tests/__data__/output/streams/us_distro.m3u'),
      [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="CGTN.cn@SD",CGTN (1080p)',
        'https://example.com/cgtn.m3u8'
      ].join('\n')
    )

    const cmd =
      'cross-env ROOT_DIR=tests/__data__/output tsx scripts/commands/playlist/exportTvboxAll.ts'
    const stdout = execSync(cmd, { encoding: 'utf8' })
    if (process.env.DEBUG === 'true') console.log(cmd, stdout)

    const playlist = fs.readFileSync(
      pathToFileURL('tests/__data__/output/tvbox/app/src/main/assets/channels_all.m3u'),
      'utf8'
    )

    expect(playlist).toContain('BBC News North America (720p)')
    expect(playlist).toContain('CNN Headlines International')
    expect(playlist).toContain('China Channel (1080p)')
    expect(playlist).toContain('Aggregator Channel')
    expect(playlist).toContain('CGTN (1080p)')
    expect(playlist).not.toContain('BBC Alba')
    expect(playlist).not.toContain('BBC Four HD (1080p) (HEVC)')
    expect(playlist).not.toContain('BBC Drama (1080p) [Geo-blocked]')
    expect(playlist).not.toContain('BBC Top Gear Germany')
    expect(playlist).not.toContain('CNN Noticias')
    expect(playlist).not.toContain('US News (720p)')
  })

  it('exports vbskycn style domestic channels in a dedicated category', () => {
    fs.writeFileSync(
      pathToFileURL('tests/__data__/output/streams/cn_vbskycn.m3u'),
      [
        '#EXTM3U x-tvg-url="http://epg.51zmt.top:8000/e.xml"',
        '#EXTINF:-1 tvg-name="北京卫视" tvg-id="27" tvg-logo="https://tb.zbds.top/logo/北京卫视.png" group-title="卫视频道", 北京卫视',
        'http://satellitepull.cnr.cn/live/wxbtv/playlist.m3u8',
        '#EXTINF:-1 tvg-name="北京卫视" tvg-id="27" tvg-logo="https://tb.zbds.top/logo/北京卫视.png" group-title="卫视频道", 北京卫视',
        'http://222.169.85.8:9901/tsfile/live/0017_1.m3u8',
        '#EXTINF:-1 tvg-name="支持作者" tvg-id="izbds" tvg-logo="" group-title="央视频道", 支持作者',
        'https://example.com/support.mp4'
      ].join('\n')
    )

    const cmd =
      'cross-env ROOT_DIR=tests/__data__/output tsx scripts/commands/playlist/exportTvboxAll.ts'
    execSync(cmd, { encoding: 'utf8' })

    const playlist = fs.readFileSync(
      pathToFileURL('tests/__data__/output/tvbox/app/src/main/assets/channels_all.m3u'),
      'utf8'
    )

    expect(playlist).toContain('北京卫视')
    expect(playlist).toContain('group-title="新加国内源",北京卫视')
    expect(playlist).toContain('http://satellitepull.cnr.cn/live/wxbtv/playlist.m3u8')
    expect(playlist).toContain('http://222.169.85.8:9901/tsfile/live/0017_1.m3u8')
    expect(playlist).not.toContain('支持作者')
  })

  it('exports episodic content as a dedicated folder', () => {
    const episodeLines = Array.from({ length: 17 }, (_, index) => {
      const episode = (index + 1).toString().padStart(2, '0')
      return [
        `#EXTINF:-1 tvg-id="" group-title="悬案",悬案 第${episode}集`,
        `https://example.com/xuanan-primary-${episode}.m3u8`,
        `#EXTINF:-1 tvg-id="" group-title="悬案",悬案 第${episode}集`,
        `https://example.com/xuanan-fallback-${episode}.m3u8`
      ]
    }).flat()
    fs.writeFileSync(
      pathToFileURL('tests/__data__/output/streams/cn_xuanan.m3u'),
      [
        '#EXTM3U',
        '# Source page: http://www.97dyy.top/dianshiju/guochanju/607fd1ba249aa3b3/player-0-0.html',
        ...episodeLines
      ].join('\n')
    )

    const cmd =
      'cross-env ROOT_DIR=tests/__data__/output tsx scripts/commands/playlist/exportTvboxAll.ts'
    execSync(cmd, { encoding: 'utf8' })

    const playlist = fs.readFileSync(
      pathToFileURL('tests/__data__/output/tvbox/app/src/main/assets/channels_all.m3u'),
      'utf8'
    )

    const exportedEpisodes = Array.from(
      playlist.matchAll(/group-title="悬案",悬案 第(\d{2})集/g),
      match => match[1],
    )
    const episodeNames = Array.from(new Set(exportedEpisodes))
    const expectedEpisodes = Array.from({ length: 17 }, (_, index) =>
      (index + 1).toString().padStart(2, '0')
    )

    expect(episodeNames).toEqual(expectedEpisodes)
    expect(exportedEpisodes).toHaveLength(34)
  })

  it('keeps all 17 authorized Suspense Case episodes in the bundled source', () => {
    // Given the production series source.
    const source = fs.readFileSync(pathToFileURL('streams/cn_xuanan.m3u'), 'utf8')

    // When its episode entries are inspected.
    const exportedEpisodes = Array.from(
      source.matchAll(/group-title="悬案",悬案 第(\d{2})集/g),
      match => match[1],
    )
    const episodeNames = Array.from(new Set(exportedEpisodes))

    // Then every episode and both configured playback sources are present.
    const expectedEpisodes = Array.from({ length: 17 }, (_, index) =>
      (index + 1).toString().padStart(2, '0')
    )
    expect(episodeNames).toEqual(expectedEpisodes)
    expect(exportedEpisodes).toHaveLength(34)
  })

  it('places 1080p streams before other resolutions', () => {
    fs.writeFileSync(
      pathToFileURL('tests/__data__/output/streams/quality.m3u'),
      [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="Low.cn@SD",Low Channel (480p)',
        'https://example.com/low.m3u8',
        '#EXTINF:-1 tvg-id="Ultra.cn@UHD",Ultra Channel (2160p)',
        'https://example.com/ultra.m3u8',
        '#EXTINF:-1 tvg-id="Full.cn@HD",Full Channel (1080p)',
        'https://example.com/full.m3u8',
        '#EXTINF:-1 tvg-id="Hd.cn@HD",HD Channel (720p)',
        'https://example.com/hd.m3u8'
      ].join('\n')
    )

    const cmd =
      'cross-env ROOT_DIR=tests/__data__/output tsx scripts/commands/playlist/exportTvboxAll.ts'
    execSync(cmd, { encoding: 'utf8' })

    const playlist = fs.readFileSync(
      pathToFileURL('tests/__data__/output/tvbox/app/src/main/assets/channels_all.m3u'),
      'utf8'
    )

    expect(playlist.indexOf('Full Channel (1080p)')).toBeLessThan(
      playlist.indexOf('HD Channel (720p)')
    )
    expect(playlist.indexOf('HD Channel (720p)')).toBeLessThan(
      playlist.indexOf('Ultra Channel (2160p)')
    )
    expect(playlist.indexOf('Ultra Channel (2160p)')).toBeLessThan(
      playlist.indexOf('Low Channel (480p)')
    )
  })
})
