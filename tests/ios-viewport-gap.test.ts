import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { IOS_VIEWPORT_GAP_SCRIPT, iosViewportGap } from '@/lib/ios-viewport-gap';

// iPhone 17 Pro Max as measured in the installed app on iOS 26: 440x956 screen, 62pt status bar.
const buggy = {
  standalone: true,
  screenWidth: 440,
  screenHeight: 956,
  innerWidth: 440,
  innerHeight: 894,
  insetTop: 62,
};

describe('iosViewportGap', () => {
  test('measures the dead band when the view is short by exactly the top inset', () => {
    assert.equal(iosViewportGap(buggy), 62);
    assert.equal(
      iosViewportGap({
        ...buggy,
        screenWidth: 393,
        screenHeight: 852,
        innerWidth: 393,
        innerHeight: 793,
        insetTop: 59,
      }),
      59,
    );
  });
  test('is 0 when the installed app fills the screen (older iOS)', () => {
    assert.equal(iosViewportGap({ ...buggy, innerHeight: 956 }), 0);
  });
  test('is 0 in a browser tab, where toolbars always make the view shorter than the screen', () => {
    assert.equal(iosViewportGap({ ...buggy, standalone: false }), 0);
    assert.equal(iosViewportGap({ ...buggy, standalone: false, innerHeight: 760, insetTop: 0 }), 0);
  });
  test('is 0 when the view starts below an opaque status bar (no top inset)', () => {
    assert.equal(iosViewportGap({ ...buggy, insetTop: 0 }), 0);
  });
  test("is 0 when the shortfall isn't the status bar (keyboard open, split view, Android bars)", () => {
    assert.equal(iosViewportGap({ ...buggy, innerHeight: 600 }), 0);
    assert.equal(iosViewportGap({ ...buggy, innerWidth: 320 }), 0);
    assert.equal(iosViewportGap({ ...buggy, innerHeight: 910 }), 0);
  });
  test('handles landscape', () => {
    assert.equal(iosViewportGap({ ...buggy, innerWidth: 956, innerHeight: 440, insetTop: 0 }), 0);
  });
  test('the inline script is self-contained', () => {
    assert.match(IOS_VIEWPORT_GAP_SCRIPT, /^\(function|^\(\(/);
    assert.doesNotMatch(IOS_VIEWPORT_GAP_SCRIPT, /\b(require|import)\b/);
  });
});
