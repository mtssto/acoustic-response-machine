# Image Environment (Phase 7)

Optional image input becomes a **spatial constraint field**, not a background plate.

## Analysis (client-side, no CV libs)

| Feature | Method | Use |
|---------|--------|-----|
| Edges | Sobel magnitude | Strength of structural preference |
| Direction field | Gradient ⊥ (edge tangent) | Bias growth heading along contours |
| Interest points | Local edge peaks | Soft attractors |
| Overlay | Short tangent strokes | Visible constraint map only |

## Growth influence (artistic)

- Sample field at active endpoints
- Blend acoustic direction toward edge tangent when edge is strong
- Mild pull toward nearby interest points
- Prefer frontier tips on high-edge regions
- Longer segments along strong edges

## Controls

- Drop image on canvas **or** press `I`
- `Esc` clears environment

Image pixels are never drawn as a photo backdrop.
