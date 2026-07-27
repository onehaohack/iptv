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

  it('keeps a bounded forward buffer in memory for unstable HLS networks', () => {
    const activityPath = path.resolve(
      __dirname,
      '../../../tvbox/app/src/main/java/org/onehao/iptvbox/MainActivity.kt',
    )
    const source = fs.readFileSync(activityPath, 'utf8')

    expect(source).toContain('import androidx.media3.exoplayer.DefaultLoadControl')
    expect(source).toContain('private const val MIN_BUFFER_MS = 30_000')
    expect(source).toContain('private const val MAX_BUFFER_MS = 90_000')
    expect(source).toContain('DefaultLoadControl.Builder()')
    expect(source).toContain('setBufferDurationsMs(')
    expect(source).toContain('setPrioritizeTimeOverSizeThresholds(true)')
    expect(source).toContain('.setLoadControl(loadControl)')
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

  it('selects the last watched Suspense Case episode before the user starts playback', () => {
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

    expect(categoriesSource).toContain('SUSPENSE_CASE_CATEGORY_NAME')
    expect(categoriesSource).toContain('const val SUSPENSE_CASE_CATEGORY_NAME = "悬案"')
    expect(activitySource).toContain('selectLastWatchedChannelInCategory')
    expect(activitySource).toContain('channelListView.setSelection')
    expect(activitySource).not.toContain('playLastWatchedChannelInCategory')
    expect(activitySource).toContain('playbackHistory.lastChannelName')
  })

  it('resumes short progress and maps remote play pause to immediate progress saving', () => {
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

    expect(activitySource).toContain('private fun togglePlayback(keyCode: Int): Boolean')
    expect(activitySource).toContain('KeyEvent.KEYCODE_DPAD_CENTER')
    expect(activitySource).toContain('KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE')
    expect(activitySource).toContain('player.pause()')
    expect(activitySource).toContain('player.play()')
    expect(activitySource).toContain('private fun play(channel: Channel) {\n        hideChannelList()')
    expect(activitySource).toContain('private const val RESUME_MIN_POSITION_MS = 1_000L')
    expect(historySource).toContain('private const val RESUME_MIN_POSITION_MS = 1_000L')
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
