/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#24272d',
    tint: '#b91e2c',
    background: '#f4f3f1',
    foreground: '#24272d',
    card: '#ffffff',
    cardForeground: '#24272d',
    primary: '#b91e2c',
    primaryForeground: '#ffffff',
    secondary: '#f7f6f4',
    secondaryForeground: '#24272d',
    muted: '#efeeec',
    mutedForeground: '#777a80',
    accent: '#f8eeee',
    accentForeground: '#a91d2a',
    destructive: '#b42318',
    destructiveForeground: '#ffffff',
    border: '#e7e6e3',
    input: '#e2e0dd',
  },
  radius: 8,
};

export default colors;
