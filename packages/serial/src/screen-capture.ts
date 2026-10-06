export const SCREEN_CAPTURE_HEIGHT = 272

export const SCREEN_CAPTURE_WIDTH = 480

export const SCREEN_CAPTURE_FRAMEBUFFER_SIZE = 512 * 272 * 4

/** Convert the V5's 512-wide BGRA framebuffer to tightly packed RGB pixels. */
export function convertScreenCapture(framebuffer: Uint8Array): Uint8Array {
  if (framebuffer.byteLength !== SCREEN_CAPTURE_FRAMEBUFFER_SIZE) {
    throw new RangeError(
      `Invalid screen framebuffer size ${framebuffer.byteLength}; expected ${SCREEN_CAPTURE_FRAMEBUFFER_SIZE}`
    )
  }

  const pixels = new Uint8Array(
    SCREEN_CAPTURE_WIDTH * SCREEN_CAPTURE_HEIGHT * 3
  )

  let source = 0
  let target = 0

  for (let row = 0; row < SCREEN_CAPTURE_HEIGHT; row++) {
    for (let column = 0; column < SCREEN_CAPTURE_WIDTH; column++) {
      pixels[target] = framebuffer[source + 2]
      pixels[target + 1] = framebuffer[source + 1]
      pixels[target + 2] = framebuffer[source]
      source += 4
      target += 3
    }

    source += (512 - SCREEN_CAPTURE_WIDTH) * 4
  }

  return pixels
}
