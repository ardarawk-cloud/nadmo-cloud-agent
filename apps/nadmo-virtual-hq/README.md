# NADMO Virtual HQ

Interactive visual headquarters for PT NADMO Studio Indonesia.

## V1 scope
- Office-style interactive HQ map
- Owner Command Center
- Media, Studio, Music, Tech, AI/Agent, Operations, Decision, Finance rooms
- Click-to-inspect room details
- Search/filter
- Responsive PC + mobile layout
- No external dependencies
- No fake live operational data

## Cloudflare Pages
Create a new Pages project from this repository.

- Production branch: `main`
- Build command: leave empty
- Build output directory: `apps/nadmo-virtual-hq`
- Suggested custom domain: `hq.nadmo.id`

## Next integration layer
1. GitHub repository/deploy status
2. Cloudflare / domain health
3. VPS/service health
4. Owner approval queue
5. Project status feed
6. Private finance data source

The V1 interface intentionally labels local configuration separately from realtime data.
