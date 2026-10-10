# MUI styles publication

The published `lib/mui/maplibre-global-styles` component requires both Emotion React and Emotion Styled alongside MUI. Declare these peers and retain them in the npm lockfile used by the existing main publication workflow. CI builds and publishes the package; local workspace links alone do not prove that the module exists in the registry.
