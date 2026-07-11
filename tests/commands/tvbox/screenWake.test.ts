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
})
