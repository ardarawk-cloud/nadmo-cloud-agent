# ARDA CORE CORPORATION — KAI 3D VIRTUAL HQ
## MASTER SPEC V5.0

Status: LOCKED CONCEPT / BUILD AUTHORITY
Owner / Final Authority: Arda
Project: ARDA CORE CORPORATION (ACC)
Core Principle: ONE CORE. MANY WORKSPACES.
Primary AI Entity: KAI
Primary Experience: Living 3D Virtual Corporation

---

## 1. PRODUCT IDENTITY

ARDA CORE CORPORATION — KAI 3D VIRTUAL HQ is not a dashboard, game skin, or static office visualization.

It is the visual operating layer of ACC.

The 3D world represents real operational state:
- divisions
- agents
- active goals
- tasks
- approvals
- blockers
- reports
- services
- infrastructure
- business metrics

The 3D world is a live representation of the corporation.

NADMO is one workspace/division inside ACC, not the parent system.

---

## 2. CORE HIERARCHY

OWNER
Arda
Final authority for goals, approvals, strategy, priority, and overrides.

KAI PRIME
Central embodied AI entity.
Responsibilities:
- corporate routing
- goal interpretation
- division selection
- work decomposition
- status aggregation
- escalation
- owner briefing
- cross-division coordination
- policy / permission enforcement

GENERAL MANAGER AI
Operational coordination layer beneath KAI.

HEAD OF DIVISION
Each workspace has a Head Agent.

WORKER AGENTS
Specialized execution agents.

TOOLS / CONNECTORS
External systems used by agents.

OWNER APPROVAL
Final checkpoint when required.

Hierarchy:
Arda → KAI Prime → GM AI → Head Division → Worker Agents → Tools / Data → Result → Approval / Report

---

## 3. KAI — EMBODIED AI PRESENCE

KAI must exist as a visible 3D entity inside the world.

KAI is not:
- a logo
- a chatbot bubble
- a menu item
- a generic robot

KAI is the visual manifestation of ACC Core.

Visual direction:
- holographic executive AI
- premium humanoid / synthetic commander silhouette
- white / titanium / electric cyan
- subtle gold authority accents
- clean energy core
- no excessive bloom
- no glitter
- readable face / mask structure
- corporate command presence

KAI occupies the KAI CORE CHAMBER in the center of ACC HQ.

KAI state must visually change:
- IDLE
- ANALYZING
- ROUTING
- WORKING
- WAITING OWNER
- ALERT
- SYSTEM DEGRADED

Examples:
- ANALYZING: holographic ring active
- ROUTING: connection lines illuminate toward target division
- WAITING OWNER: gold pulse toward Owner Room
- ALERT: controlled red accent
- DEGRADED: dimmed core + warning node

---

## 4. ACC WORLD STRUCTURE

### ACC CORE
Central headquarters.

Contains:
- Owner Room
- KAI Core Chamber
- Decision Room
- Strategy Room
- Approval Gateway
- Corporate Status Wall
- Alert / Incident Center

### NADMO STUDIO WORKSPACE
Functions:
- websites
- design
- creative production
- client projects
- product build
- digital services

Agents:
- Head Studio
- Web Builder
- UI / Design
- Client Ops
- Production QA

### MEDIA & NIGHTLIFE WORKSPACE
Functions:
- BaliNightlife
- Aku Cinta Malam
- Bali Wedding DJ
- content publishing
- editorial
- campaign monitoring

Agents:
- Head Media
- Editorial
- Content Producer
- Publisher
- Research / Scout
- Campaign Ops

### MUSIC & ENTERTAINMENT WORKSPACE
Functions:
- Arda Moron
- Kamikaze
- releases
- cover production
- catalog
- distribution
- DJ assets

Agents:
- Head Music
- A&R
- Release Ops
- Artwork
- Metadata
- Distribution Monitor

### TECH & INFRA WORKSPACE
Functions:
- GitHub
- Cloudflare
- VPS
- domains
- deployments
- runtime health
- app operations

Agents:
- Head Tech
- DevOps
- GitHub Monitor
- Cloudflare Monitor
- Runtime QC
- Domain Watch

### FINANCE WORKSPACE
Functions:
- income
- expenses
- business targets
- tax
- invoices
- reporting

Agents:
- Head Finance
- Revenue Analyst
- Expense Controller
- Tax / Compliance
- Reporting

### ENTERPRISE / BUSINESS WORKSPACE
Functions:
- business development
- client pipeline
- company services
- offers
- commercial strategy

### CIVIC / PUBLIC PROJECTS WORKSPACE
Reserved for ACC Civic projects.

### HOSPITALITY WORKSPACE
Reserved for travel, villa, hotel, F&B, hospitality projects.

### ACADEMY WORKSPACE
Reserved for learning, training, research, knowledge systems.

Future workspaces can be added without changing ACC Core architecture.

---

## 5. WORLD DESIGN PRINCIPLES

The experience should feel like opening a living AI corporation.

Required:
- true 3D scene using WebGL
- free camera pan
- zoom
- focus on room
- focus on agent
- visible agent movement
- workstations
- department zones
- animated status indicators
- connection pathways
- KAI routing lines
- owner approval route
- day / night or simulation time control later

Avoid:
- card-grid dashboard as the main view
- flat room rectangles as final production design
- fake KPI numbers
- decorative robot icons with no state
- excessive visual effects
- unreadable neon
- game UI that hides business information

The world is primary.
Panels are secondary overlays.

---

## 6. AGENT VISUAL MODEL

Every operational agent is a persistent entity.

Agent data:
- id
- name
- role
- division
- level
- manager
- direct reports
- responsibilities
- authority
- authority limits
- services / tools
- status
- current task
- current room
- KPI
- recent activity
- conversation context
- approval state

Agent visible states:
- IDLE
- PLANNING
- MOVING
- WORKING
- REVIEWING
- WAITING_DEPENDENCY
- WAITING_APPROVAL
- DONE
- ERROR

Agent behavior:
1. receives work
2. leaves idle workstation
3. moves to relevant department / node
4. performs task
5. emits activity / progress
6. moves to review or approval area if needed
7. returns to workstation after completion

Movement must reflect backend state, not random animation.

---

## 7. AGENT PROFILE PANEL

Clicking an agent opens a right-side profile panel.

Required tabs:
- PROFIL
- TUGAS
- KPI
- AKTIVITAS
- CHAT
- SERVICES

Profile:
- name
- role
- division
- level
- manager
- team
- responsibilities
- authority
- limits

Task:
- active tasks
- progress
- deadline
- dependency
- output
- approval status

KPI:
- only real metrics when connected
- clearly label simulated / local / live

Activity:
- timestamped event stream

Chat:
- direct conversation / brief context

Services:
- connected tools
- missing tools
- service health
- permission scope

Primary actions:
- BERI TUGAS
- TETAPKAN TUJUAN
- LIHAT LAPORAN
- BUKA PERCAKAPAN
- PANGGIL KE DECISION ROOM

---

## 8. GOAL SYSTEM

Owner gives GOALS, not only micro-tasks.

Goal object:
- title
- division
- owner
- business context
- product / brand
- period
- target
- target metric
- margin / budget if relevant
- deadline
- success criteria
- constraints
- priority
- notes

Flow:
1. Arda sets a goal
2. KAI interprets goal
3. KAI selects relevant divisions
4. GM / Head decomposes goal
5. Worker agents receive tasks
6. dependencies are tracked
7. work happens
8. results roll upward
9. KAI summarizes
10. Owner approves / revises / rejects

Cross-division goals can create parallel workstreams.

---

## 9. DECISION ROOM

Dedicated ACC room for:
- owner decisions
- escalations
- blockers
- conflicting recommendations
- approval requests
- high-risk actions
- budget decisions
- release decisions
- legal / compliance review

Decision Card:
- issue
- requested by
- division
- context
- options
- recommendation
- risk
- cost
- deadline
- supporting evidence
- Approve / Reject / Revise / Hold

No destructive or external action should occur without required permission.

---

## 10. REPORTING

Reports are business objects, not decorative charts.

Report types:
- Division Report
- Project Report
- Campaign Report
- Sales / Revenue Report
- Infrastructure Report
- Release Report
- Agent Performance Report
- Goal Progress Report
- Incident Report

Every metric must have source status:
- LIVE
- MANUAL
- SIMULATED
- ESTIMATED
- UNAVAILABLE

Never present simulated values as live.

---

## 11. REALTIME EVENT SYSTEM

Frontend world subscribes to event stream.

Event examples:
- agent.status.changed
- agent.moved
- task.created
- task.started
- task.progress
- task.completed
- approval.requested
- approval.resolved
- connector.online
- connector.offline
- incident.opened
- goal.created
- goal.routed
- report.generated

WebSocket / realtime channel updates the 3D scene immediately.

---

## 12. ARCHITECTURE

### Frontend
Preferred:
- React
- React Three Fiber / Three.js
- Zustand or equivalent state store
- WebSocket client
- responsive overlay UI

### 3D
- WebGL
- low-poly / premium stylized corporate sci-fi
- modular rooms
- reusable agent rig
- animation state machine
- camera controller
- route/path system

### Backend
Preferred:
- FastAPI or Node service
- event-driven task / goal engine
- agent registry
- orchestration layer
- approval engine
- reporting service
- connector service
- WebSocket hub

### Data
- persistent DB for:
  - agents
  - goals
  - tasks
  - events
  - approvals
  - reports
  - divisions
  - connectors
  - permissions

### ACC / KAI Integration
KAI orchestrator is separated from 3D frontend.

The frontend visualizes KAI state.
The backend executes KAI logic.

---

## 13. CONNECTOR LAYER

Initial real connectors:
- GitHub
- Cloudflare
- VPS / service health
- ACC project data

Later:
- publishing / media systems
- analytics
- finance sources
- calendar
- Drive / Docs
- internal APIs
- business systems

Each connector must expose:
- connection state
- permissions
- last sync
- data freshness
- error state

Disconnected services must visibly show:
LAYANAN BELUM TERHUBUNG

---

## 14. SECURITY / AUTHORITY

Owner is final authority.

KAI and agents operate inside scoped permissions.

Action classes:
A. READ / ANALYZE
B. DRAFT / PREPARE
C. INTERNAL WRITE
D. EXTERNAL ACTION
E. HIGH-RISK ACTION

D and E may require explicit Owner approval depending on policy.

All important actions create event logs.

---

## 15. KAI CORE UI

When KAI is selected:

Tabs:
- OVERVIEW
- GOALS
- ROUTING
- DIVISIONS
- ALERTS
- DECISIONS
- ACTIVITY
- CHAT

KAI Overview:
- active goals
- divisions working
- blockers
- waiting owner
- system health
- active incidents

KAI can visually highlight:
- target division
- blocked path
- pending approval
- critical alert

---

## 16. SIMULATION MODE VS LIVE MODE

The system supports two modes.

SIMULATION MODE
- accelerated time allowed
- synthetic tasks allowed
- clearly labeled DEMO / SIMULATION
- useful for scenario testing

LIVE MODE
- connected operational data
- real task state
- actual connector health
- actual reports where available

Mode must always be clearly visible.

Never mix simulated KPI and real KPI without labeling.

---

## 17. V5 MVP

The first production-grade V5 must include:

1. ACC 3D world
2. KAI Core Chamber
3. Owner Room
4. 4 initial workspaces:
   - NADMO Studio
   - Media
   - Music
   - Tech / Infra
5. reusable 3D agent character
6. click agent → profile panel
7. Goal modal
8. Task modal
9. realtime agent state
10. agent movement
11. Decision Room
12. Owner Approval
13. activity event stream
14. GitHub live connector
15. explicit LIVE / LOCAL / SIMULATED labels
16. persistent backend state

Finance enters after the operational engine is stable.

---

## 18. BUILD PHASES

PHASE A — FOUNDATION
- repo / app structure
- backend state model
- agent registry
- event model
- WebSocket
- ACC naming cleanup

PHASE B — 3D WORLD
- ACC floor
- KAI chamber
- owner room
- initial divisions
- agent model
- camera
- path movement

PHASE C — OPERATIONS
- goal creation
- task assignment
- delegation
- activity log
- approval queue
- reports shell

PHASE D — REAL CONNECTORS
- GitHub
- Cloudflare
- VPS
- project data

PHASE E — KAI ORCHESTRATION
- KAI goal routing
- task decomposition
- cross-division coordination
- owner briefing

PHASE F — SCALE
- additional ACC workspaces
- finance
- business analytics
- media publishing
- automation
- mobile optimization

---

## 19. MIGRATION RULE

Previous NADMO Virtual HQ V1–V4 is prototype history only.

Do not use its architecture as production foundation.

Reusable lessons:
- visual language
- interaction experiments
- task / approval concept

Production V5 starts from ACC architecture.

Target app naming:
- ACC Virtual HQ
- ACC OS X
- KAI Core

NADMO remains a workspace under ACC.

---

## 20. FINAL PRODUCT STATEMENT

ARDA CORE CORPORATION — KAI 3D VIRTUAL HQ is a living visual operating system for ACC.

Arda controls the corporation.
KAI operates the core.
Divisions execute.
Agents work.
Tools connect to real systems.
The 3D world reflects what is actually happening.

ONE CORE.
MANY WORKSPACES.
ONE OWNER.
