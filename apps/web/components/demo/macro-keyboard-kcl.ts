/**
 * "Agentic Macro Keyboard" — real Zoo Design Studio model from the Aquarium
 * gallery (zoo.dev/aquarium/2ef8a70b-f4a3-49bc-b650-f4d89bf8f54e, by Joe).
 * Executed as-is by the Zoo engine in the /demo/engineer simulated run.
 */
export const MACRO_KEYBOARD_KCL = `// Macro Keyboard for controlling AI agents
// 5 dedicated controls for agentic apps
// 6 programmable macros
// Dial and joystick

@settings(defaultLengthUnit = mm, kclVersion = 1.0)

// ---------------------------------------------------------------- parameters
keyPitch = 19.05
caseWidth = 104
caseCornerRadius = 16
deckWidth = 92
deckCornerRadius = 12
shellBottomZ = 1.5
shellTopZ = 15.5
deckRecess = 1.9
// keydeck floor sits deckRecess below the shell rim; everything mounted on
// the deck (switches, caps, bolts, dial, joystick, touch sensor, chips)
// derives its Z from deckZ so changing deckRecess moves the whole stack
deckZ = shellTopZ - deckRecess
switchHeight = 3.3
capBottomZ = deckZ + switchHeight + 0.1
capUnit = 17.4
// the aluminum disc IS the product's foot: slightly oversized so it
// overhangs the shell and peeks out in a top-down view
footOverhang = 1.5
discRadius = caseWidth / 2 + footOverhang
discHeight = 1.5

// grid column / row centers (4 x 4, centered on origin)
colOuter = 1.5 * keyPitch
colInner = 0.5 * keyPitch

// ---------------------------------------------------------------- planes
planeDesk = {
  origin = [0, 0, 0],
  xAxis = [1.0, 0.0, 0.0],
  yAxis = [0.0, 1.0, 0.0]
}
planeShell = {
  origin = [0, 0, shellBottomZ],
  xAxis = [1.0, 0.0, 0.0],
  yAxis = [0.0, 1.0, 0.0]
}
planeDeck = {
  origin = [0, 0, deckZ],
  xAxis = [1.0, 0.0, 0.0],
  yAxis = [0.0, 1.0, 0.0]
}
planeDeckEngrave = {
  origin = [0, 0, deckZ - 0.25],
  xAxis = [1.0, 0.0, 0.0],
  yAxis = [0.0, 1.0, 0.0]
}
planeCap = {
  origin = [0, 0, capBottomZ],
  xAxis = [1.0, 0.0, 0.0],
  yAxis = [0.0, 1.0, 0.0]
}
planeIcon = {
  origin = [0, 0, capBottomZ + 6.4],
  xAxis = [1.0, 0.0, 0.0],
  yAxis = [0.0, 1.0, 0.0]
}
planeHexSocket = {
  origin = [0, 0, deckZ + 0.7],
  xAxis = [1.0, 0.0, 0.0],
  yAxis = [0.0, 1.0, 0.0]
}
planeJoyCap = {
  origin = [0, 0, deckZ + 4.4],
  xAxis = [1.0, 0.0, 0.0],
  yAxis = [0.0, 1.0, 0.0]
}
planeJoyGroove = {
  origin = [0, 0, deckZ + 11.6],
  xAxis = [1.0, 0.0, 0.0],
  yAxis = [0.0, 1.0, 0.0]
}
planeScoop = {
  origin = [0, 0, deckZ + 11.4],
  xAxis = [1.0, 0.0, 0.0],
  yAxis = [0.0, 1.0, 0.0]
}
planeBlossom = {
  origin = [0, 0, -0.5],
  xAxis = [1.0, 0.0, 0.0],
  yAxis = [0.0, 1.0, 0.0]
}
planeGripRing = {
  origin = [0, 0, -0.3],
  xAxis = [1.0, 0.0, 0.0],
  yAxis = [0.0, 1.0, 0.0]
}
// back wall, normal pointing -Y (into the case)
planeUsb = {
  origin = [0, 52.1, 9.2],
  xAxis = [1.0, 0.0, 0.0],
  yAxis = [0.0, 0.0, 1.0]
}
planeUsbInsert = {
  origin = [0, 50.2, 9.2],
  xAxis = [1.0, 0.0, 0.0],
  yAxis = [0.0, 0.0, 1.0]
}

// ============================================================ aluminum base
// milled disc with anti-slip ring groove and engraved blossom-clock mark
discSketch = sketch(on = planeDesk) {
  c1 = circle(start = [var 53.5, var 0], center = [var 0, var 0])
  coincident([c1.center, ORIGIN])
  radius(c1) == discRadius
}
discRegion = region(segments = [discSketch.c1])
hide(discSketch)
discBody = extrude(discRegion, length = discHeight)
  |> chamfer(length = 0.7, tags = [edgeId(closestTo = [discRadius, 0, 0])])

// anti-slip ring groove near the rim (bottom face)
gripRingSketch = sketch(on = planeGripRing) {
  cOuter = circle(start = [var 51.5, var 0], center = [var 0, var 0])
  cInner = circle(start = [var 48.9, var 0], center = [var 0, var 0])
  coincident([cOuter.center, ORIGIN])
  coincident([cInner.center, ORIGIN])
  radius(cOuter) == discRadius - 2
  radius(cInner) == discRadius - 4.6
}
gripRingRegion = region(point = [discRadius - 3.3, 0], sketch = gripRingSketch)
hide(gripRingSketch)
gripRingTool = extrude(gripRingRegion, length = 0.7)

// blossom mark: six lobes + core, debossed into the bottom face
lobe1Sketch = sketch(on = planeBlossom) {
  c1 = circle(start = [var 15.5, var 0], center = [var 9, var 0])
}
lobe1Region = region(segments = [lobe1Sketch.c1])
hide(lobe1Sketch)
lobe1Tool = extrude(lobe1Region, length = 1.0)

lobe2Sketch = sketch(on = planeBlossom) {
  c1 = circle(start = [var 11, var 7.794], center = [var 4.5, var 7.794])
}
lobe2Region = region(segments = [lobe2Sketch.c1])
hide(lobe2Sketch)
lobe2Tool = extrude(lobe2Region, length = 1.0)

lobe3Sketch = sketch(on = planeBlossom) {
  c1 = circle(start = [var 2, var 7.794], center = [var -4.5, var 7.794])
}
lobe3Region = region(segments = [lobe3Sketch.c1])
hide(lobe3Sketch)
lobe3Tool = extrude(lobe3Region, length = 1.0)

lobe4Sketch = sketch(on = planeBlossom) {
  c1 = circle(start = [var -2.5, var 0], center = [var -9, var 0])
}
lobe4Region = region(segments = [lobe4Sketch.c1])
hide(lobe4Sketch)
lobe4Tool = extrude(lobe4Region, length = 1.0)

lobe5Sketch = sketch(on = planeBlossom) {
  c1 = circle(start = [var 2, var -7.794], center = [var -4.5, var -7.794])
}
lobe5Region = region(segments = [lobe5Sketch.c1])
hide(lobe5Sketch)
lobe5Tool = extrude(lobe5Region, length = 1.0)

lobe6Sketch = sketch(on = planeBlossom) {
  c1 = circle(start = [var 11, var -7.794], center = [var 4.5, var -7.794])
}
lobe6Region = region(segments = [lobe6Sketch.c1])
hide(lobe6Sketch)
lobe6Tool = extrude(lobe6Region, length = 1.0)

coreSketch = sketch(on = planeBlossom) {
  c1 = circle(start = [var 7, var 0], center = [var 0, var 0])
}
coreRegion = region(segments = [coreSketch.c1])
hide(coreSketch)
coreTool = extrude(coreRegion, length = 1.0)

// clock hands, engraved deeper inside the blossom pocket
hand1Sketch = sketch(on = planeBlossom) {
  line1 = line(start = [var -5.231, var -6.079], end = [var -6.079, var -5.231])
  line2 = line(start = [var -6.079, var -5.231], end = [var -1.129, var -0.281])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -1.129, var -0.281], end = [var -0.281, var -1.129])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -0.281, var -1.129], end = [var -5.231, var -6.079])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
hand1Region = region(point = [-3.18, -3.18], sketch = hand1Sketch)
hide(hand1Sketch)
hand1Tool = extrude(hand1Region, length = 1.8)

hand2Sketch = sketch(on = planeBlossom) {
  line1 = line(start = [var 3.770, var -5.330], end = [var 2.730, var -5.930])
  line2 = line(start = [var 2.730, var -5.930], end = [var -0.020, var -1.166])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -0.020, var -1.166], end = [var 1.020, var -0.566])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 1.020, var -0.566], end = [var 3.770, var -5.330])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
hand2Region = region(point = [1.875, -3.248], sketch = hand2Sketch)
hide(hand2Sketch)
hand2Tool = extrude(hand2Region, length = 1.8)

aluminumBase = subtract(
  discBody,
  tools = [
    gripRingTool,
    lobe1Tool,
    lobe2Tool,
    lobe3Tool,
    lobe4Tool,
    lobe5Tool,
    lobe6Tool,
    coreTool,
    hand1Tool,
    hand2Tool
  ],
)
  |> appearance(color = "#ccd2d8", metalness = 88, roughness = 26)

// ============================================================ frosted shell
// sandblasted polycarbonate unibody with recessed key deck
shellSketch = sketch(on = planeShell) {
  line1 = line(start = [var -52, var -52], end = [var 52, var -52])
  line2 = line(start = [var 52, var -52], end = [var 52, var 52])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 52, var 52], end = [var -52, var 52])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -52, var 52], end = [var -52, var -52])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  horizontal(line1)
  vertical(line2)
  horizontal(line3)
  vertical(line4)
  coincident([
    line1.start,
    [-caseWidth / 2, -caseWidth / 2]
  ])
  distance([line1.start, line1.end]) == caseWidth
  distance([line2.start, line2.end]) == caseWidth
}
shellRegion = region(point = [0, 0], sketch = shellSketch)
hide(shellSketch)
shellRaw = extrude(shellRegion, length = 14.0)
  |> fillet(
       radius = caseCornerRadius,
       tags = [
         edgeId(closestTo = [-52, -52, 8.5]),
         edgeId(closestTo = [52, -52, 8.5]),
         edgeId(closestTo = [52, 52, 8.5]),
         edgeId(closestTo = [-52, 52, 8.5])
       ],
     )
  |> fillet(radius = 2.5, tags = [edgeId(closestTo = [0, -52, 15.5])])

// deck pocket tool
pocketSketch = sketch(on = planeDeck) {
  line1 = line(start = [var -46, var -46], end = [var 46, var -46])
  line2 = line(start = [var 46, var -46], end = [var 46, var 46])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 46, var 46], end = [var -46, var 46])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -46, var 46], end = [var -46, var -46])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  horizontal(line1)
  vertical(line2)
  horizontal(line3)
  vertical(line4)
  coincident([
    line1.start,
    [-deckWidth / 2, -deckWidth / 2]
  ])
  distance([line1.start, line1.end]) == deckWidth
  distance([line2.start, line2.end]) == deckWidth
}
pocketRegion = region(point = [0, 0], sketch = pocketSketch)
hide(pocketSketch)
pocketTool = extrude(pocketRegion, length = 3.0)
  |> fillet(
       radius = deckCornerRadius,
       tags = [
         edgeId(closestTo = [-46, -46, deckZ + 1.5]),
         edgeId(closestTo = [46, -46, deckZ + 1.5]),
         edgeId(closestTo = [46, 46, deckZ + 1.5]),
         edgeId(closestTo = [-46, 46, deckZ + 1.5])
       ],
     )

// USB-C recess tool, back wall
usbSketch = sketch(on = planeUsb) {
  lineTop = line(start = [var 2.9, var 1.7], end = [var -2.9, var 1.7])
  arcLeft = arc(start = [var -2.9, var 1.7], end = [var -2.9, var -1.7], center = [var -2.9, var 0])
  coincident([lineTop.end, arcLeft.start])
  lineBottom = line(start = [var -2.9, var -1.7], end = [var 2.9, var -1.7])
  coincident([arcLeft.end, lineBottom.start])
  arcRight = arc(start = [var 2.9, var -1.7], end = [var 2.9, var 1.7], center = [var 2.9, var 0])
  coincident([lineBottom.end, arcRight.start])
  coincident([arcRight.end, lineTop.start])
}
usbRegion = region(point = [0, 0], sketch = usbSketch)
hide(usbSketch)
usbTool = extrude(usbRegion, length = 4.5)

// deck arrow marking (above the top key row)
arrowSketch = sketch(on = planeDeckEngrave) {
  line1 = line(start = [var -0.5, var 39.8], end = [var 0.5, var 39.8])
  line2 = line(start = [var 0.5, var 39.8], end = [var 0.5, var 42.3])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 0.5, var 42.3], end = [var 1.8, var 42.3])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 1.8, var 42.3], end = [var 0, var 44.4])
  coincident([line3.end, line4.start])
  line5 = line(start = [var 0, var 44.4], end = [var -1.8, var 42.3])
  coincident([line4.end, line5.start])
  line6 = line(start = [var -1.8, var 42.3], end = [var -0.5, var 42.3])
  coincident([line5.end, line6.start])
  line7 = line(start = [var -0.5, var 42.3], end = [var -0.5, var 39.8])
  coincident([line6.end, line7.start])
  coincident([line7.end, line1.start])
}
arrowRegion = region(point = [0, 42.0], sketch = arrowSketch)
hide(arrowSketch)
arrowTool = extrude(arrowRegion, length = 0.5)

// dashed marking around the joystick cell
dashNorthSketch = sketch(on = planeDeckEngrave) {
  line1 = line(start = [var 27.075, var 38.525], end = [var 30.075, var 38.525])
  line2 = line(start = [var 30.075, var 38.525], end = [var 30.075, var 39.025])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 30.075, var 39.025], end = [var 27.075, var 39.025])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 27.075, var 39.025], end = [var 27.075, var 38.525])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
dashNorthRegion = region(point = [28.575, 38.775], sketch = dashNorthSketch)
hide(dashNorthSketch)
dashNorthTool = extrude(dashNorthRegion, length = 0.5)

dashSouthSketch = sketch(on = planeDeckEngrave) {
  line1 = line(start = [var 27.075, var 18.125], end = [var 30.075, var 18.125])
  line2 = line(start = [var 30.075, var 18.125], end = [var 30.075, var 18.625])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 30.075, var 18.625], end = [var 27.075, var 18.625])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 27.075, var 18.625], end = [var 27.075, var 18.125])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
dashSouthRegion = region(point = [28.575, 18.375], sketch = dashSouthSketch)
hide(dashSouthSketch)
dashSouthTool = extrude(dashSouthRegion, length = 0.5)

dashEastSketch = sketch(on = planeDeckEngrave) {
  line1 = line(start = [var 38.525, var 27.075], end = [var 39.025, var 27.075])
  line2 = line(start = [var 39.025, var 27.075], end = [var 39.025, var 30.075])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 39.025, var 30.075], end = [var 38.525, var 30.075])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 38.525, var 30.075], end = [var 38.525, var 27.075])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
dashEastRegion = region(point = [38.775, 28.575], sketch = dashEastSketch)
hide(dashEastSketch)
dashEastTool = extrude(dashEastRegion, length = 0.5)

dashWestSketch = sketch(on = planeDeckEngrave) {
  line1 = line(start = [var 18.4, var 27.075], end = [var 18.9, var 27.075])
  line2 = line(start = [var 18.9, var 27.075], end = [var 18.9, var 30.075])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 18.9, var 30.075], end = [var 18.4, var 30.075])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 18.4, var 30.075], end = [var 18.4, var 27.075])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
dashWestRegion = region(point = [18.65, 28.575], sketch = dashWestSketch)
hide(dashWestSketch)
dashWestTool = extrude(dashWestRegion, length = 0.5)

shellPocketed = subtract(shellRaw, tools = [pocketTool])
shellPorted = subtract(shellPocketed, tools = [usbTool])
shellMarked = subtract(shellPorted, tools = [arrowTool])
shellBody = subtract(
  shellMarked,
  tools = [
    dashNorthTool,
    dashSouthTool,
    dashEastTool,
    dashWestTool
  ],
)
  |> appearance(color = "#fbfdff", roughness = 26)

// USB-C connector tongue inside the recess
usbInsertSketch = sketch(on = planeUsbInsert) {
  line1 = line(start = [var -4.1, var -1.35], end = [var 4.1, var -1.35])
  line2 = line(start = [var 4.1, var -1.35], end = [var 4.1, var 1.35])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 4.1, var 1.35], end = [var -4.1, var 1.35])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -4.1, var 1.35], end = [var -4.1, var -1.35])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
usbInsertRegion = region(point = [0, 0], sketch = usbInsertSketch)
hide(usbInsertSketch)
usbInsert = extrude(usbInsertRegion, length = 0.8)
  |> appearance(color = "#17181a", roughness = 40)

// ============================================================ corner screws
// black hex-socket screws at the four deck corners
screw1HeadSketch = sketch(on = planeDeck) {
  c1 = circle(start = [var -35.8, var -38.5], center = [var -38.5, var -38.5])
}
screw1HeadRegion = region(segments = [screw1HeadSketch.c1])
hide(screw1HeadSketch)
screw1Head = extrude(screw1HeadRegion, length = 1.3)

screw1HexSketch = sketch(on = planeHexSocket) {
  line1 = line(start = [var -37.201, var -37.75], end = [var -38.5, var -37.0])
  line2 = line(start = [var -38.5, var -37.0], end = [var -39.799, var -37.75])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -39.799, var -37.75], end = [var -39.799, var -39.25])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -39.799, var -39.25], end = [var -38.5, var -40.0])
  coincident([line3.end, line4.start])
  line5 = line(start = [var -38.5, var -40.0], end = [var -37.201, var -39.25])
  coincident([line4.end, line5.start])
  line6 = line(start = [var -37.201, var -39.25], end = [var -37.201, var -37.75])
  coincident([line5.end, line6.start])
  coincident([line6.end, line1.start])
}
screw1HexRegion = region(point = [-38.5, -38.5], sketch = screw1HexSketch)
hide(screw1HexSketch)
screw1HexTool = extrude(screw1HexRegion, length = 0.9)

screw1 = subtract(screw1Head, tools = [screw1HexTool])
  |> appearance(color = "#141518", metalness = 40, roughness = 35)

screw2HeadSketch = sketch(on = planeDeck) {
  c1 = circle(start = [var 41.2, var -38.5], center = [var 38.5, var -38.5])
}
screw2HeadRegion = region(segments = [screw2HeadSketch.c1])
hide(screw2HeadSketch)
screw2Head = extrude(screw2HeadRegion, length = 1.3)

screw2HexSketch = sketch(on = planeHexSocket) {
  line1 = line(start = [var 39.799, var -37.75], end = [var 38.5, var -37.0])
  line2 = line(start = [var 38.5, var -37.0], end = [var 37.201, var -37.75])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 37.201, var -37.75], end = [var 37.201, var -39.25])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 37.201, var -39.25], end = [var 38.5, var -40.0])
  coincident([line3.end, line4.start])
  line5 = line(start = [var 38.5, var -40.0], end = [var 39.799, var -39.25])
  coincident([line4.end, line5.start])
  line6 = line(start = [var 39.799, var -39.25], end = [var 39.799, var -37.75])
  coincident([line5.end, line6.start])
  coincident([line6.end, line1.start])
}
screw2HexRegion = region(point = [38.5, -38.5], sketch = screw2HexSketch)
hide(screw2HexSketch)
screw2HexTool = extrude(screw2HexRegion, length = 0.9)

screw2 = subtract(screw2Head, tools = [screw2HexTool])
  |> appearance(color = "#141518", metalness = 40, roughness = 35)

screw3HeadSketch = sketch(on = planeDeck) {
  c1 = circle(start = [var -35.8, var 38.5], center = [var -38.5, var 38.5])
}
screw3HeadRegion = region(segments = [screw3HeadSketch.c1])
hide(screw3HeadSketch)
screw3Head = extrude(screw3HeadRegion, length = 1.3)

screw3HexSketch = sketch(on = planeHexSocket) {
  line1 = line(start = [var -37.201, var 39.25], end = [var -38.5, var 40.0])
  line2 = line(start = [var -38.5, var 40.0], end = [var -39.799, var 39.25])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -39.799, var 39.25], end = [var -39.799, var 37.75])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -39.799, var 37.75], end = [var -38.5, var 37.0])
  coincident([line3.end, line4.start])
  line5 = line(start = [var -38.5, var 37.0], end = [var -37.201, var 37.75])
  coincident([line4.end, line5.start])
  line6 = line(start = [var -37.201, var 37.75], end = [var -37.201, var 39.25])
  coincident([line5.end, line6.start])
  coincident([line6.end, line1.start])
}
screw3HexRegion = region(point = [-38.5, 38.5], sketch = screw3HexSketch)
hide(screw3HexSketch)
screw3HexTool = extrude(screw3HexRegion, length = 0.9)

screw3 = subtract(screw3Head, tools = [screw3HexTool])
  |> appearance(color = "#141518", metalness = 40, roughness = 35)

screw4HeadSketch = sketch(on = planeDeck) {
  c1 = circle(start = [var 41.2, var 38.5], center = [var 38.5, var 38.5])
}
screw4HeadRegion = region(segments = [screw4HeadSketch.c1])
hide(screw4HeadSketch)
screw4Head = extrude(screw4HeadRegion, length = 1.3)

screw4HexSketch = sketch(on = planeHexSocket) {
  line1 = line(start = [var 39.799, var 39.25], end = [var 38.5, var 40.0])
  line2 = line(start = [var 38.5, var 40.0], end = [var 37.201, var 39.25])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 37.201, var 39.25], end = [var 37.201, var 37.75])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 37.201, var 37.75], end = [var 38.5, var 37.0])
  coincident([line3.end, line4.start])
  line5 = line(start = [var 38.5, var 37.0], end = [var 39.799, var 37.75])
  coincident([line4.end, line5.start])
  line6 = line(start = [var 39.799, var 37.75], end = [var 39.799, var 39.25])
  coincident([line5.end, line6.start])
  coincident([line6.end, line1.start])
}
screw4HexRegion = region(point = [38.5, 38.5], sketch = screw4HexSketch)
hide(screw4HexSketch)
screw4HexTool = extrude(screw4HexRegion, length = 0.9)

screw4 = subtract(screw4Head, tools = [screw4HexTool])
  |> appearance(color = "#141518", metalness = 40, roughness = 35)

// ============================================================ switch housings
// 13 low-profile switches: master at row1-col2, cloned everywhere else
housingSketch = sketch(on = planeDeck) {
  line1 = line(start = [var -16.525, var 21.575], end = [var -2.525, var 21.575])
  line2 = line(start = [var -2.525, var 21.575], end = [var -2.525, var 35.575])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -2.525, var 35.575], end = [var -16.525, var 35.575])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -16.525, var 35.575], end = [var -16.525, var 21.575])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
housingRegion = region(point = [-9.525, 28.575], sketch = housingSketch)
hide(housingSketch)
housing1 = extrude(housingRegion, length = switchHeight)
  |> appearance(color = "#26282c", roughness = 55)

housing2 = clone(housing1)
  |> translate(x = keyPitch, global = true)
housing3 = clone(housing1)
  |> translate(x = -keyPitch, y = -keyPitch, global = true)
housing4 = clone(housing1)
  |> translate(y = -keyPitch, global = true)
housing5 = clone(housing1)
  |> translate(x = keyPitch, y = -keyPitch, global = true)
housing6 = clone(housing1)
  |> translate(x = 2 * keyPitch, y = -keyPitch, global = true)
housing7 = clone(housing1)
  |> translate(x = -keyPitch, y = -2 * keyPitch, global = true)
housing8 = clone(housing1)
  |> translate(y = -2 * keyPitch, global = true)
housing9 = clone(housing1)
  |> translate(x = keyPitch, y = -2 * keyPitch, global = true)
housing10 = clone(housing1)
  |> translate(x = 2 * keyPitch, y = -2 * keyPitch, global = true)
housing11 = clone(housing1)
  |> translate(y = -3 * keyPitch, global = true)
housing12 = clone(housing1)
  |> translate(x = keyPitch, y = -3 * keyPitch, global = true)
housing13 = clone(housing1)
  |> translate(x = 2 * keyPitch, y = -3 * keyPitch, global = true)

// ============================================================ translucent caps
// rows 1-2 (teal, amber, blue, white, blue, pink) — same profile as icon caps
capASketch = sketch(on = planeCap) {
  line1 = line(start = [var -18.225, var 19.875], end = [var -0.825, var 19.875])
  line2 = line(start = [var -0.825, var 19.875], end = [var -0.825, var 37.275])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -0.825, var 37.275], end = [var -18.225, var 37.275])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -18.225, var 37.275], end = [var -18.225, var 19.875])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
capARegion = region(point = [-9.525, 28.575], sketch = capASketch)
hide(capASketch)
capATeal = extrude(capARegion, length = 6.8)
  |> fillet(
       radius = 4.0,
       tags = [
         edgeId(closestTo = [-18.225, 19.875, capBottomZ + 3.4]),
         edgeId(closestTo = [-0.825, 19.875, capBottomZ + 3.4]),
         edgeId(closestTo = [-0.825, 37.275, capBottomZ + 3.4]),
         edgeId(closestTo = [-18.225, 37.275, capBottomZ + 3.4])
       ],
     )
  |> fillet(
       radius = 2.6,
       tags = [
         edgeId(closestTo = [-9.525, 19.875, capBottomZ + 6.8])
       ],
     )
  |> appearance(color = "#00ffcc", roughness = 8, opacity = 50)

capAAmber = clone(capATeal)
  |> translate(x = keyPitch, global = true)
  |> appearance(color = "#ff8800", roughness = 8, opacity = 50)

capABlue1 = clone(capATeal)
  |> translate(x = -keyPitch, y = -keyPitch, global = true)
  |> appearance(color = "#29acff", roughness = 8, opacity = 50)

capAWhite = clone(capATeal)
  |> translate(y = -keyPitch, global = true)
  |> appearance(color = "#ffffff", roughness = 8, opacity = 50)

capABlue2 = clone(capATeal)
  |> translate(x = keyPitch, y = -keyPitch, global = true)
  |> appearance(color = "#29acff", roughness = 8, opacity = 50)

capAPink = clone(capATeal)
  |> translate(x = 2 * keyPitch, y = -keyPitch, global = true)
  |> appearance(color = "#ff2f9e", roughness = 8, opacity = 50)

// ============================================================ white icon caps
// row 3: lightning, check, x, share — plus cloud key bottom-right
capBSketch = sketch(on = planeCap) {
  line1 = line(start = [var -37.275, var -18.225], end = [var -19.875, var -18.225])
  line2 = line(start = [var -19.875, var -18.225], end = [var -19.875, var -0.825])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -19.875, var -0.825], end = [var -37.275, var -0.825])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -37.275, var -0.825], end = [var -37.275, var -18.225])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
capBRegion = region(point = [-28.575, -9.525], sketch = capBSketch)
hide(capBSketch)
capBLightningRaw = extrude(capBRegion, length = 6.8)
  |> fillet(
       radius = 4.0,
       tags = [
         edgeId(closestTo = [-37.275, -18.225, capBottomZ + 3.4]),
         edgeId(closestTo = [-19.875, -18.225, capBottomZ + 3.4]),
         edgeId(closestTo = [-19.875, -0.825, capBottomZ + 3.4]),
         edgeId(closestTo = [-37.275, -0.825, capBottomZ + 3.4])
       ],
     )
  |> fillet(
       radius = 2.6,
       tags = [
         edgeId(closestTo = [-28.575, -18.225, capBottomZ + 6.8])
       ],
     )

capBCheckRaw = clone(capBLightningRaw)
  |> translate(x = keyPitch, global = true)
capBexRaw = clone(capBLightningRaw)
  |> translate(x = 2 * keyPitch, global = true)
capBShareRaw = clone(capBLightningRaw)
  |> translate(x = 3 * keyPitch, global = true)
capBCloudRaw = clone(capBLightningRaw)
  |> translate(x = 3 * keyPitch, y = -keyPitch, global = true)

// lightning bolt glyph
boltSketch = sketch(on = planeIcon) {
  line1 = line(start = [var -27.675, var -6.325], end = [var -30.275, var -9.925])
  line2 = line(start = [var -30.275, var -9.925], end = [var -28.725, var -9.925])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -28.725, var -9.925], end = [var -29.475, var -12.725])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -29.475, var -12.725], end = [var -26.875, var -9.125])
  coincident([line3.end, line4.start])
  line5 = line(start = [var -26.875, var -9.125], end = [var -28.425, var -9.125])
  coincident([line4.end, line5.start])
  line6 = line(start = [var -28.425, var -9.125], end = [var -27.675, var -6.325])
  coincident([line5.end, line6.start])
  coincident([line6.end, line1.start])
}
boltRegion = region(point = [-28.575, -9.525], sketch = boltSketch)
hide(boltSketch)
boltTool = extrude(boltRegion, length = 1.0)

keyLightning = subtract(capBLightningRaw, tools = [boltTool])
  |> appearance(color = "#ffffff", roughness = 30)

// check icon: ring + tick
checkRingSketch = sketch(on = planeIcon) {
  cOuter = circle(start = [var -5.525, var -9.525], center = [var -9.525, var -9.525])
  cInner = circle(start = [var -6.225, var -9.525], center = [var -9.525, var -9.525])
}
checkRingRegion = region(point = [-9.525, -5.875], sketch = checkRingSketch)
hide(checkRingSketch)
checkRingTool = extrude(checkRingRegion, length = 1.0)

checkTickSketch = sketch(on = planeIcon) {
  line1 = line(start = [var -11.825, var -9.125], end = [var -10.225, var -10.725])
  line2 = line(start = [var -10.225, var -10.725], end = [var -7.225, var -7.725])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -7.225, var -7.725], end = [var -7.925, var -7.025])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -7.925, var -7.025], end = [var -10.225, var -9.325])
  coincident([line3.end, line4.start])
  line5 = line(start = [var -10.225, var -9.325], end = [var -11.125, var -8.425])
  coincident([line4.end, line5.start])
  line6 = line(start = [var -11.125, var -8.425], end = [var -11.825, var -9.125])
  coincident([line5.end, line6.start])
  coincident([line6.end, line1.start])
}
checkTickRegion = region(point = [-10.225, -10.0], sketch = checkTickSketch)
hide(checkTickSketch)
checkTickTool = extrude(checkTickRegion, length = 1.0)

keyCheck = subtract(capBCheckRaw, tools = [checkRingTool, checkTickTool])
  |> appearance(color = "#ffffff", roughness = 30)

// x icon: ring + crossed bars
xRingSketch = sketch(on = planeIcon) {
  cOuter = circle(start = [var 13.525, var -9.525], center = [var 9.525, var -9.525])
  cInner = circle(start = [var 12.825, var -9.525], center = [var 9.525, var -9.525])
}
xRingRegion = region(point = [9.525, -5.875], sketch = xRingSketch)
hide(xRingSketch)
xRingTool = extrude(xRingRegion, length = 1.0)

xBar1Sketch = sketch(on = planeIcon) {
  line1 = line(start = [var 10.695, var -7.585], end = [var 11.465, var -8.355])
  line2 = line(start = [var 11.465, var -8.355], end = [var 8.355, var -11.465])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 8.355, var -11.465], end = [var 7.585, var -10.695])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 7.585, var -10.695], end = [var 10.695, var -7.585])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
xBar1Region = region(point = [9.525, -9.525], sketch = xBar1Sketch)
hide(xBar1Sketch)
xBar1Tool = extrude(xBar1Region, length = 1.0)

xBar2Sketch = sketch(on = planeIcon) {
  line1 = line(start = [var 8.355, var -7.585], end = [var 7.585, var -8.355])
  line2 = line(start = [var 7.585, var -8.355], end = [var 10.695, var -11.465])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 10.695, var -11.465], end = [var 11.465, var -10.695])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 11.465, var -10.695], end = [var 8.355, var -7.585])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
xBar2Region = region(point = [9.525, -9.525], sketch = xBar2Sketch)
hide(xBar2Sketch)
xBar2Tool = extrude(xBar2Region, length = 1.0)

keyX = subtract(capBexRaw, tools = [xRingTool, xBar1Tool, xBar2Tool])
  |> appearance(color = "#ffffff", roughness = 30)

// share icon: diagonal shaft + arrow head
shareShaftSketch = sketch(on = planeIcon) {
  line1 = line(start = [var 29.147, var -8.245], end = [var 29.855, var -8.953])
  line2 = line(start = [var 29.855, var -8.953], end = [var 26.603, var -12.205])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 26.603, var -12.205], end = [var 25.895, var -11.497])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 25.895, var -11.497], end = [var 29.147, var -8.245])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
shareShaftRegion = region(point = [27.875, -10.225], sketch = shareShaftSketch)
hide(shareShaftSketch)
shareShaftTool = extrude(shareShaftRegion, length = 1.0)

shareHeadSketch = sketch(on = planeIcon) {
  line1 = line(start = [var 31.475, var -6.625], end = [var 29.275, var -7.025])
  line2 = line(start = [var 29.275, var -7.025], end = [var 31.075, var -8.825])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 31.075, var -8.825], end = [var 31.475, var -6.625])
  coincident([line2.end, line3.start])
  coincident([line3.end, line1.start])
}
shareHeadRegion = region(point = [30.608, -7.492], sketch = shareHeadSketch)
hide(shareHeadSketch)
shareHeadTool = extrude(shareHeadRegion, length = 1.0)

keyShare = subtract(capBShareRaw, tools = [shareShaftTool, shareHeadTool])
  |> appearance(color = "#ffffff", roughness = 30)

// cloud icon: overlapping puddle circles
cloud1Sketch = sketch(on = planeIcon) {
  c1 = circle(start = [var 28.475, var -28.575], center = [var 26.875, var -28.575])
}
cloud1Region = region(segments = [cloud1Sketch.c1])
hide(cloud1Sketch)
cloud1Tool = extrude(cloud1Region, length = 1.0)

cloud2Sketch = sketch(on = planeIcon) {
  c1 = circle(start = [var 30.375, var -27.575], center = [var 28.575, var -27.575])
}
cloud2Region = region(segments = [cloud2Sketch.c1])
hide(cloud2Sketch)
cloud2Tool = extrude(cloud2Region, length = 1.0)

cloud3Sketch = sketch(on = planeIcon) {
  c1 = circle(start = [var 31.875, var -28.575], center = [var 30.275, var -28.575])
}
cloud3Region = region(segments = [cloud3Sketch.c1])
hide(cloud3Sketch)
cloud3Tool = extrude(cloud3Region, length = 1.0)

cloud4Sketch = sketch(on = planeIcon) {
  c1 = circle(start = [var 29.975, var -29.175], center = [var 28.575, var -29.175])
}
cloud4Region = region(segments = [cloud4Sketch.c1])
hide(cloud4Sketch)
cloud4Tool = extrude(cloud4Region, length = 1.0)

keyCloud = subtract(
  capBCloudRaw,
  tools = [
    cloud1Tool,
    cloud2Tool,
    cloud3Tool,
    cloud4Tool
  ],
)
  |> appearance(color = "#ffffff", roughness = 30)

// ============================================================ 2U mic key
micCapSketch = sketch(on = planeCap) {
  line1 = line(start = [var -18.225, var -37.275], end = [var 18.225, var -37.275])
  line2 = line(start = [var 18.225, var -37.275], end = [var 18.225, var -19.875])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 18.225, var -19.875], end = [var -18.225, var -19.875])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -18.225, var -19.875], end = [var -18.225, var -37.275])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
micCapRegion = region(point = [0, -28.575], sketch = micCapSketch)
hide(micCapSketch)
micCapRaw = extrude(micCapRegion, length = 6.8)
  |> fillet(
       radius = 7.0,
       tags = [
         edgeId(closestTo = [-18.225, -37.275, capBottomZ + 3.4]),
         edgeId(closestTo = [18.225, -37.275, capBottomZ + 3.4]),
         edgeId(closestTo = [18.225, -19.875, capBottomZ + 3.4]),
         edgeId(closestTo = [-18.225, -19.875, capBottomZ + 3.4])
       ],
     )
  |> fillet(
       radius = 2.6,
       tags = [
         edgeId(closestTo = [0, -37.275, capBottomZ + 6.8])
       ],
     )

// mic glyph: capsule body + stem + base bar
micBodySketch = sketch(on = planeIcon) {
  lineLeft = line(start = [var -1.3, var -26.275], end = [var -1.3, var -28.875])
  arcBottom = arc(start = [var -1.3, var -28.875], end = [var 1.3, var -28.875], center = [var 0, var -28.875])
  coincident([lineLeft.end, arcBottom.start])
  lineRight = line(start = [var 1.3, var -28.875], end = [var 1.3, var -26.275])
  coincident([arcBottom.end, lineRight.start])
  arcTop = arc(start = [var 1.3, var -26.275], end = [var -1.3, var -26.275], center = [var 0, var -26.275])
  coincident([lineRight.end, arcTop.start])
  coincident([arcTop.end, lineLeft.start])
}
micBodyRegion = region(point = [0, -27.575], sketch = micBodySketch)
hide(micBodySketch)
micBodyTool = extrude(micBodyRegion, length = 1.0)

micStemSketch = sketch(on = planeIcon) {
  line1 = line(start = [var -0.4, var -31.575], end = [var 0.4, var -31.575])
  line2 = line(start = [var 0.4, var -31.575], end = [var 0.4, var -30.175])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 0.4, var -30.175], end = [var -0.4, var -30.175])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -0.4, var -30.175], end = [var -0.4, var -31.575])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
micStemRegion = region(point = [0, -30.875], sketch = micStemSketch)
hide(micStemSketch)
micStemTool = extrude(micStemRegion, length = 1.0)

micBaseSketch = sketch(on = planeIcon) {
  line1 = line(start = [var -1.6, var -32.175], end = [var 1.6, var -32.175])
  line2 = line(start = [var 1.6, var -32.175], end = [var 1.6, var -31.575])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 1.6, var -31.575], end = [var -1.6, var -31.575])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -1.6, var -31.575], end = [var -1.6, var -32.175])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
micBaseRegion = region(point = [0, -31.875], sketch = micBaseSketch)
hide(micBaseSketch)
micBaseTool = extrude(micBaseRegion, length = 1.0)

keyMic = subtract(micCapRaw, tools = [micBodyTool, micStemTool, micBaseTool])
  |> appearance(color = "#ffffff", roughness = 30)

// ============================================================ rotary dial
// white knob with a concave thumb scoop, top-left corner
dialSketch = sketch(on = planeDeck) {
  c1 = circle(start = [var -19.875, var 28.575], center = [var -28.575, var 28.575])
}
dialRegion = region(segments = [dialSketch.c1])
hide(dialSketch)
dialRaw = extrude(dialRegion, length = 15.9)

// half cutaway: chord-aligned step across the knob top (cut faces the pad
// center), floor blended into the wall with a concave fillet at the bottom
scoopSketch = sketch(on = planeScoop) {
  line1 = line(start = [var -19.029, var 35.999], end = [var -7.715, var 24.685])
  line2 = line(start = [var -7.715, var 24.685], end = [var -24.685, var 7.715])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -24.685, var 7.715], end = [var -35.999, var 19.029])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -35.999, var 19.029], end = [var -19.029, var 35.999])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
scoopRegion = region(point = [-25.393, 25.393], sketch = scoopSketch)
hide(scoopSketch)
scoopTool = extrude(scoopRegion, length = 5.6)

dialKnob = subtract(dialRaw, tools = [scoopTool])
  |> appearance(color = "#ffffff", roughness = 16)

// ============================================================ joystick
// planar joystick with black rubber cap, X-groove on top
joyStemSketch = sketch(on = planeDeck) {
  c1 = circle(start = [var 32.575, var 28.575], center = [var 28.575, var 28.575])
}
joyStemRegion = region(segments = [joyStemSketch.c1])
hide(joyStemSketch)
joyStem = extrude(joyStemRegion, length = 4.4)
  |> appearance(color = "#0e0f11", roughness = 45)

joyCapSketch = sketch(on = planeJoyCap) {
  line1 = line(start = [var 20.075, var 20.075], end = [var 37.075, var 20.075])
  line2 = line(start = [var 37.075, var 20.075], end = [var 37.075, var 37.075])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 37.075, var 37.075], end = [var 20.075, var 37.075])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 20.075, var 37.075], end = [var 20.075, var 20.075])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
joyCapRegion = region(point = [28.575, 28.575], sketch = joyCapSketch)
hide(joyCapSketch)
joyCapRaw = extrude(joyCapRegion, length = 8.0)
  |> fillet(
       radius = 6.5,
       tags = [
         edgeId(closestTo = [20.075, 20.075, deckZ + 8.4]),
         edgeId(closestTo = [37.075, 20.075, deckZ + 8.4]),
         edgeId(closestTo = [37.075, 37.075, deckZ + 8.4]),
         edgeId(closestTo = [20.075, 37.075, deckZ + 8.4])
       ],
     )
  |> fillet(
       radius = 3.0,
       tags = [
         edgeId(closestTo = [28.575, 20.075, deckZ + 12.4])
       ],
     )

joyGroove1Sketch = sketch(on = planeJoyGroove) {
  line1 = line(start = [var 32.182, var 33.454], end = [var 33.454, var 32.182])
  line2 = line(start = [var 33.454, var 32.182], end = [var 24.968, var 23.696])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 24.968, var 23.696], end = [var 23.696, var 24.968])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 23.696, var 24.968], end = [var 32.182, var 33.454])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
joyGroove1Region = region(point = [28.575, 28.575], sketch = joyGroove1Sketch)
hide(joyGroove1Sketch)
joyGroove1Tool = extrude(joyGroove1Region, length = 1.4)

joyGroove2Sketch = sketch(on = planeJoyGroove) {
  line1 = line(start = [var 24.968, var 33.454], end = [var 23.696, var 32.182])
  line2 = line(start = [var 23.696, var 32.182], end = [var 32.182, var 23.696])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 32.182, var 23.696], end = [var 33.454, var 24.968])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 33.454, var 24.968], end = [var 24.968, var 33.454])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
joyGroove2Region = region(point = [28.575, 28.575], sketch = joyGroove2Sketch)
hide(joyGroove2Sketch)
joyGroove2Tool = extrude(joyGroove2Region, length = 1.4)

joyCap = subtract(joyCapRaw, tools = [joyGroove1Tool, joyGroove2Tool])
  |> appearance(color = "#0e0f11", roughness = 45)

// ============================================================ touch sensor
touchSketch = sketch(on = planeDeck) {
  c1 = circle(start = [var -23.075, var -28.575], center = [var -28.575, var -28.575])
}
touchRegion = region(segments = [touchSketch.c1])
hide(touchSketch)
touchSensor = extrude(touchRegion, length = 0.8)
  |> appearance(color = "#0c0d0e", roughness = 35)

// SMD components beside the touch sensor
chipSketch = sketch(on = planeDeck) {
  line1 = line(start = [var -36.6, var -26.2], end = [var -34.4, var -26.2])
  line2 = line(start = [var -34.4, var -26.2], end = [var -34.4, var -24.8])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -34.4, var -24.8], end = [var -36.6, var -24.8])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -36.6, var -24.8], end = [var -36.6, var -26.2])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
chipRegion = region(point = [-35.5, -25.5], sketch = chipSketch)
hide(chipSketch)
chips = extrude(chipRegion, length = 0.8)
  |> appearance(color = "#d8ab2a", metalness = 70, roughness = 40)
  |> patternLinear3d(axis = [0.0, -1.0, 0.0], instances = 3, distance = 3.0)

edge001 = edgeId(dialKnob, index = 10)
//fillet001 = fillet(dialKnob, tags = edge001, radius = 2)
`;

const STAGE_MARKERS = [
  "// ============================================================ frosted shell",
  "// ============================================================ switch housings",
];

/** Progressive build: stage 1 = aluminum base, 2 = + shell, 3 = everything. */
export function macroKeyboardKclForStage(stage: number): string {
  if (stage >= 3) return MACRO_KEYBOARD_KCL;
  const marker = STAGE_MARKERS[Math.max(stage, 1) - 1]!;
  const cut = MACRO_KEYBOARD_KCL.indexOf(marker);
  return cut === -1 ? MACRO_KEYBOARD_KCL : MACRO_KEYBOARD_KCL.slice(0, cut);
}
