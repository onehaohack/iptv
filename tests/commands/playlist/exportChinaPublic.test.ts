import { pathToFileURL } from 'node:url'
import { execSync } from 'child_process'
import fs from 'fs-extra'

beforeEach(() => {
  fs.emptyDirSync('tests/__data__/output')
  fs.ensureDirSync('tests/__data__/output/streams')
  fs.ensureDirSync('tests/__data__/output/tvbox/app/src/main/assets')
})

describe('playlist:export:china-public', () => {
  it('exports only official public China streams', () => {
    fs.writeFileSync(
      pathToFileURL('tests/__data__/output/streams/cn.m3u'),
      [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="Official.cn@HD",Official TV (1080p)',
        'https://live.example.gztv.com/live/official.m3u8',
        '#EXTINF:-1 tvg-id="Aggregator.cn@HD",Aggregator TV (1080p)',
        'http://epg.112114.xyz/douyu/4332',
        '#EXTINF:-1 tvg-id="Blocked.cn@HD",Blocked TV (1080p) [Geo-blocked]',
        'https://news.cgtn.com/resource/live/blocked.m3u8',
        '#EXTINF:-1 tvg-id="JiangxiCityChannel.cn@SD",Known Failing Official TV (1080p)',
        'https://play-live-hls.jxtvcn.com.cn/live-city/tv_jxtv2.m3u8'
      ].join('\n')
    )
    fs.writeFileSync(
      pathToFileURL('tests/__data__/output/streams/cn_cctv.m3u'),
      [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="CCTVPlus1.cn@SD",CCTV+ 1 (600p) [Not 24/7]',
        'https://cd-live-stream.news.cctvplus.com/live/smil:CHANNEL1.smil/playlist.m3u8'
      ].join('\n')
    )
    fs.writeFileSync(
      pathToFileURL('tests/__data__/output/streams/cn_cgtn.m3u'),
      [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="CGTN.cn@SD",CGTN (576p)',
        'https://news.cgtn.com/resource/live/english/cgtn-news.m3u8'
      ].join('\n')
    )

    const cmd =
      'cross-env ROOT_DIR=tests/__data__/output tsx scripts/commands/playlist/exportChinaPublic.ts'
    const stdout = execSync(cmd, { encoding: 'utf8' })
    if (process.env.DEBUG === 'true') console.log(cmd, stdout)

    const playlist = fs.readFileSync(
      pathToFileURL('tests/__data__/output/tvbox/app/src/main/assets/channels_cn_public.m3u'),
      'utf8'
    )

    expect(playlist).toContain('Official TV (1080p)')
    expect(playlist).toContain('CCTV+ 1 (600p) [Not 24/7]')
    expect(playlist).toContain('CGTN (576p)')
    expect(playlist).not.toContain('Aggregator TV')
    expect(playlist).not.toContain('Blocked TV')
    expect(playlist).not.toContain('Known Failing Official TV')
  })
})
