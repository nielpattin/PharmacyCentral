# Persistent filters and output layout

## Active source
- `C:\Users\niel\loot-drop\loot_drop_rebuilds.json`

## Data rule
- Only use rows where `drop = false`
- Keep `drop_reasons` on rows for rejected ideas
- Do not invent new permanent keyword bans from temporary frustration
- Prefer dropping specific ideas by row instead of banning broad categories

## Hard filters
- .NET backend friendly
- React frontend friendly
- PostgreSQL friendly
- backend-heavy
- web-first
- digital-only
- microservice-friendly
- can split into .NET services and at least one Go service naturally
- AI should be secondary, around 20-40 percent of the product, not the whole product

## Exclude
- mobile-first
- streaming, music, video
- edu, exam, tutor, mentor, coach
- dating, matchmaking, relationship
- sports
- assistant, copilot, advisor, chatbot wrapper
- crypto product
- ad or advertising product
- HR product

## Picking rules
- keep previous `drop = true` history
- do not ban whole lanes unless user explicitly says so again
- prefer ideas that can show real product engineering depth on CV
- prefer products with user side plus company/admin/operator side when possible
- prefer products that can naturally include auth, RBAC, audit log, approval flow, queue, scheduler, search, and background jobs

## Default output style for `5_ideas.md`
Use this layout for every idea.

### Title
`## {index}. {idea_name}`

### Required fields
- `**Nguồn rebuild:** \'{original_name} -> {pivot_name}\'`
- `**Original fail signal:** {primary_cause_of_death}`
- `**Market potential / Difficulty:** {market_potential} / {difficulty}`

### Required sections
- `**Ý tưởng:**`
- `**Tại sao đáng làm:**`
- `**Tại sao hợp skill của mày:**`
- `**Microservice split (.NET + Go):**`
- `**Core entities:**`
- `**MVP:**`

### Writing rules
- 80% Vietnamese
- medium detail, not too short
- direct and technical
- no long intro fluff
- no generic startup buzzword spam
- explain backend value clearly
- keep each idea separated by `---`
- do not add a final "pick best" block at the end
