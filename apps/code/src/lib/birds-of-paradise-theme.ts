import { registerCustomTheme, type ThemeRegistration } from '@pierre/diffs'

export const birdsOfParadiseTheme = 'birds-of-paradise'

registerCustomTheme(birdsOfParadiseTheme, async () => {
  const { default: theme } = await import('~/themes/birds-of-paradise.json')
  const tokenColors = theme.tokenColors.map((token, index) =>
    index === 0
      ? {
          ...token,
          settings: {
            ...token.settings,
            background: 'var(--background)',
          },
        }
      : token,
  )

  return {
    ...theme,
    name: birdsOfParadiseTheme,
    type: 'dark',
    colors: {
      ...theme.colors,
      'editor.background': 'var(--background)',
    },
    settings: tokenColors,
    tokenColors,
  } as unknown as ThemeRegistration
})
