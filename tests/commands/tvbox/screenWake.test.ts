import fs from 'fs-extra'
import path from 'path'

describe('tvbox screen wake behavior', () => {
  it('keeps the screen awake while MainActivity is visible', () => {
    const activityPath = path.resolve(
      __dirname,
      '../../../tvbox/app/src/main/java/org/onehao/iptvbox/MainActivity.kt',
    )
    const source = fs.readFileSync(activityPath, 'utf8')

    expect(source).toContain('WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON')
    expect(source).toContain('window.addFlags')
  })

  it('persists playback progress for movies and series episodes', () => {
    const activityPath = path.resolve(
      __dirname,
      '../../../tvbox/app/src/main/java/org/onehao/iptvbox/MainActivity.kt',
    )
    const historyPath = path.resolve(
      __dirname,
      '../../../tvbox/app/src/main/java/org/onehao/iptvbox/PlaybackHistory.kt',
    )
    const activitySource = fs.readFileSync(activityPath, 'utf8')
    const historySource = fs.readFileSync(historyPath, 'utf8')

    expect(historySource).toContain('PLAYBACK_PROGRESS_PREFIX')
    expect(activitySource).toContain('savePlaybackProgress')
    expect(activitySource).toContain('clearPlaybackProgress')
    expect(historySource).toContain('fun load')
    expect(activitySource).toContain('resumePositionMs')
  })

  it('does not save terminal progress after playback has ended', () => {
    const activityPath = path.resolve(
      __dirname,
      '../../../tvbox/app/src/main/java/org/onehao/iptvbox/MainActivity.kt',
    )
    const source = fs.readFileSync(activityPath, 'utf8')

    expect(source).toContain('private var playbackEnded = false')
    expect(source).toContain('playbackEnded = false')
    expect(source).toContain('playbackEnded = true')
    expect(source).toContain('if (playbackEnded) return')
  })

  it('resumes Xiangcun Love 18 from the last watched episode when opening the folder', () => {
    const activityPath = path.resolve(
      __dirname,
      '../../../tvbox/app/src/main/java/org/onehao/iptvbox/MainActivity.kt',
    )
    const categoriesPath = path.resolve(
      __dirname,
      '../../../tvbox/app/src/main/java/org/onehao/iptvbox/ChannelCategories.kt',
    )
    const activitySource = fs.readFileSync(activityPath, 'utf8')
    const categoriesSource = fs.readFileSync(categoriesPath, 'utf8')

    expect(categoriesSource).toContain('XIANGCUN_LOVE_18_CATEGORY_NAME')
    expect(activitySource).toContain('playLastWatchedChannelInCategory')
    expect(activitySource).toContain('playbackHistory.lastChannelName')
  })

  it('cancels scheduled progress saving before clearing a completed episode', () => {
    const activityPath = path.resolve(
      __dirname,
      '../../../tvbox/app/src/main/java/org/onehao/iptvbox/MainActivity.kt',
    )
    const source = fs.readFileSync(activityPath, 'utf8')
    const endedBlock = source.match(/Player\.STATE_ENDED -> \{[\s\S]*?\n\s*}/)?.[0] || ''

    expect(endedBlock.indexOf('cancelProgressSave()')).toBeGreaterThan(-1)
    expect(endedBlock.indexOf('cancelProgressSave()')).toBeLessThan(
      endedBlock.indexOf('clearPlaybackProgress()'),
    )
  })

  it('does not log full playback URLs or migrate playback history into backups', () => {
    const activityPath = path.resolve(
      __dirname,
      '../../../tvbox/app/src/main/java/org/onehao/iptvbox/MainActivity.kt',
    )
    const manifestPath = path.resolve(
      __dirname,
      '../../../tvbox/app/src/main/AndroidManifest.xml',
    )
    const rulesPath = path.resolve(
      __dirname,
      '../../../tvbox/app/src/main/res/xml/data_extraction_rules.xml',
    )
    const activitySource = fs.readFileSync(activityPath, 'utf8')
    const manifestSource = fs.readFileSync(manifestPath, 'utf8')
    const rulesSource = fs.readFileSync(rulesPath, 'utf8')

    expect(activitySource).not.toContain(': $source')
    expect(manifestSource).toContain('android:allowBackup="false"')
    expect(manifestSource).toContain('android:dataExtractionRules="@xml/data_extraction_rules"')
    expect(rulesSource).toContain('onehao_iptv_box.xml')
  })
})
