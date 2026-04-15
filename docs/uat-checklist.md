# UAT Checklist — flightdeck

## UAT-01: App Launch
- [ ] UAT-01-A: Electron window opens within 10s
- [ ] UAT-01-B: Window title contains "flightdeck"
- [ ] UAT-01-C: NavRail visible with 6 nav buttons

## UAT-02: Navigation
- [ ] UAT-02-A: Dashboard view active on launch
- [ ] UAT-02-B: Click Sessions nav → Sessions view loads
- [ ] UAT-02-C: Click Projects nav → Projects view loads
- [ ] UAT-02-D: Click Tasks nav → Kanban view loads
- [ ] UAT-02-E: Click Analytics nav → Analytics view loads
- [ ] UAT-02-F: Click Settings nav → Settings view loads
- [ ] UAT-02-G: Keyboard shortcut key="2" navigates to Sessions

## UAT-03: Dashboard
- [ ] UAT-03-A: Dashboard renders (no crash)
- [ ] UAT-03-B: Contains heading or grid area

## UAT-04: Sessions View
- [ ] UAT-04-A: Sessions view renders
- [ ] UAT-04-B: "Attention" toggle/filter visible

## UAT-05: Projects View
- [ ] UAT-05-A: Projects view renders
- [ ] UAT-05-B: Empty state or project list visible

## UAT-06: Tasks / Kanban View
- [ ] UAT-06-A: Kanban view renders (no crash)

## UAT-07: Analytics View
- [ ] UAT-07-A: Analytics view renders (no crash)

## UAT-08: Settings View
- [ ] UAT-08-A: Settings view renders
- [ ] UAT-08-B: Mock mode toggle visible (label "Mock" or similar)
- [ ] UAT-08-C: Theme selector visible

## UAT-09: CmdK Dispatch Overlay
- [ ] UAT-09-A: Pressing Cmd+K opens dispatch overlay
- [ ] UAT-09-B: Pressing Escape closes the overlay

## UAT-10: Context Panel
- [ ] UAT-10-A: Context panel is hidden on load (no session selected)
