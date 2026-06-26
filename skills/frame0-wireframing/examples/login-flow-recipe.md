# Worked Example — Login + Home, a Connector, a Link, and Export

A complete, copy-adaptable build: a **login screen** and a **home screen**, a visible flow **connector**
between them, a clickable **`set_link`** on the login button, and a final **export**. Tool calls are shown as
`tool { params }`; `→ id:X` means "remember the returned id as X". Coordinates are illustrative — adjust to your
canvas; `move_shape`/`align_shapes` tidy the rest.

> Precondition: the Frame0 desktop app is running (the MCP bridges to it locally). If calls fail with a
> connection error, ask the user to launch Frame0.

## Step 0 — Decide fidelity
Request is "wireframe a login that goes to a home screen." Structure/flow is the point, no brand named →
**stay low-fi in Frame0**. Grayscale only.

## Step 1 — Login page + frame
```
add_page { name: "Login" }                                  # becomes current page  → pageId:LOGIN
create_frame { frameType: "phone", name: "Login Screen" }   # → id:F_LOGIN
```

## Step 2 — Login content (every shape parentId: F_LOGIN)
```
create_text      { name:"Title", type:"heading", text:"Welcome back",
                   left:40, top:120, parentId:F_LOGIN }                         # → id:T_TITLE

# email field
create_rectangle { name:"EmailBox", left:40, top:200, width:300, height:44,
                   corners:[4,4,4,4], strokeColor:"#000000", parentId:F_LOGIN } # → id:R_EMAIL
create_text      { name:"EmailPlaceholder", type:"normal", text:"Email",
                   left:52, top:214, fontColor:"#999999", parentId:F_LOGIN }    # → id:T_EMAIL

# password field
create_rectangle { name:"PwBox", left:40, top:260, width:300, height:44,
                   corners:[4,4,4,4], strokeColor:"#000000", parentId:F_LOGIN } # → id:R_PW
create_text      { name:"PwPlaceholder", type:"normal", text:"Password",
                   left:52, top:274, fontColor:"#999999", parentId:F_LOGIN }    # → id:T_PW

# login button = rectangle + centered label
create_rectangle { name:"LoginBtn", left:40, top:330, width:300, height:48,
                   corners:[6,6,6,6], fillColor:"#FFFFFF", strokeColor:"#000000",
                   parentId:F_LOGIN }                                           # → id:R_BTN
create_text      { name:"LoginBtnLabel", type:"label", text:"Log in",
                   left:160, top:344, parentId:F_LOGIN }                        # → id:T_BTN
align_shapes     { alignType:"align-horizontal-center", shapeIdArray:[R_BTN, T_BTN] }
align_shapes     { alignType:"align-vertical-center",   shapeIdArray:[R_BTN, T_BTN] }
```
(Icons example: if you wanted a lock glyph, `search_icons { keyword:"lock" }` first, then
`create_icon { name:"lock", size:"medium", left:.., top:.., parentId:F_LOGIN }`.)

## Step 3 — Home page + frame (create the target BEFORE linking)
```
add_page { name: "Home" }                                   # → pageId:HOME (now current)
create_frame { frameType: "phone", name: "Home Screen" }    # → id:F_HOME

# navbar
create_rectangle { name:"NavBar", left:0, top:0, width:380, height:56,
                   strokeColor:"#000000", parentId:F_HOME }                     # → id:R_NAV
create_text      { name:"NavTitle", type:"heading", text:"Home",
                   left:16, top:16, parentId:F_HOME }                           # → id:T_NAV
search_icons     { keyword:"bell" }                          # confirm a valid name
create_icon      { name:"bell", size:"medium", left:336, top:16, parentId:F_HOME } # → id:I_BELL

# a list row, then duplicate it down
create_rectangle { name:"Row1", left:0, top:56, width:380, height:56,
                   strokeColor:"#CCCCCC", parentId:F_HOME }                     # → id:R_ROW1
create_text      { name:"Row1Label", type:"normal", text:"First item",
                   left:16, top:76, parentId:F_HOME }                          # → id:T_ROW1
duplicate_shape  { shapeId:R_ROW1, dy:56 }                   # → id:R_ROW2  (repeat as needed)
```

## Step 4 — Wire the flow
Visible arrow for the wireflow map (if both frames share a page; here they're on separate pages, so this is
optional — use it on a dedicated "User Flow" page that holds lightweight copies):
```
# (optional, on a flow page) create_connector { name:"login -> home",
#   startId:F_LOGIN, endId:F_HOME, endArrowhead:"arrow" }
```
Clickable navigation — the login button actually goes to Home (target page already exists from Step 3):
```
set_link { shapeId:R_BTN, linkType:"page", pageId:HOME }
```
Add a back affordance on Home later with `set_link { shapeId:<backBtn>, linkType:"action:backward" }`.

## Step 5 — Review
```
set_current_page_by_id { pageId: LOGIN }
export_page_as_image  { format:"image/png" }     # share the Login screen
set_current_page_by_id { pageId: HOME }
export_page_as_image  { format:"image/png" }     # share the Home screen
```

## What this demonstrates
- **Page-before-frame**, and **parentId on every child**.
- **Button = rectangle + centered label** via `align_shapes`.
- **Field = rectangle + grey placeholder**, repeated rows via `duplicate_shape` `dy`.
- **`search_icons` before `create_icon`** for valid glyph names.
- **Target page created before `set_link`** (no unknown-ID failure).
- **Grayscale throughout** — structure first; visuals are a later, separate (hi-fi) pass.

Adapt by swapping screen contents; the skeleton (page → frame → parented shapes → align → link → export) is the
same for any wireframe or wireflow.
