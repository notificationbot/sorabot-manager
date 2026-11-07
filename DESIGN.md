# SoraBot Manager design

## Surface

Operate mode: room administrators find a feature, understand its saved state, and change it with confidence. Room identity stays visible; the server determines room and permissions.

## Visual language

User-selected pastel glass surfaces with dark ink and forest-green switches. Category cards use mint for room administration, lavender for activity, peach for games and sky blue for daily features; the separate game-limit card uses warm lavender. A subtle pastel background wash connects the groups. Functional status colors carry feedback; there are no decorative metrics or illustrations. Typography uses local system sans-serif fonts with Korean fallbacks.

## Layout

Desktop: global header, restrained category sidebar, room identity hero and a searchable two-column group-card layout. The room name stays on one line, fits down to 18px and uses ellipsis only if still too long; its full value remains in the title attribute. Mobile: horizontally scrollable categories, room identity and a single column of group cards. Authentication uses a compact form beside a concise introduction, stacked on mobile. Five games expose maximum-bet controls together in one card immediately after the game group. The hint shows minimum and 0 for removing the room limit; fishing additionally explains its existing 1,000,000P default maximum. Internal JavaScript numeric ceilings are not presented as product policy.

## Interaction

Standard labelled switches report saved state. Switching waits for API confirmation. All changes are serialized; uncertain results require refresh. Concurrent edits reload current state and ask the administrator to try the intended change again. Errors offer recovery in Korean. Focus rings, native form semantics, keyboard operation, 44-pixel interaction areas and reduced-motion support are required.

Signed connection verification precedes the password form. Password acceptance opens a dedicated approval step: copy `/기능 인증 CODE`, enter it in the same chat with the same administrator, and wait for approval before accessing controls. Secrets remain in memory. A restrained glass arrival animation runs only when the manager opens, and respects reduced motion.

## Tokens

- Background: `#faf9f5`; content surface: `#fffefa`; sidebar: `#f3f3ed`
- Ink: `#242e29`; muted text: `#626d63`
- Primary forest: `#234f40`; selected category: `#dfe8da`
- Dividers: `#dedfd6`; fields: `#ccd1c5`
- Radius: 7–8px controls, 16px authentication panel
- Desktop spacing: 24px interaction groups, 42–48px workspace inset

The runtime has no external fonts, tracking or hosted media. daisyUI is vendored; custom CSS supplies the approved palette, responsive composition and density.
