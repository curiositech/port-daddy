#!/usr/bin/env swift
// Exact-window interaction driver for the pd-console terminal-drawer proof.
//
// This helper never searches by app name and never clicks the operator's front
// window. The capture script passes a proof-owned CGWindowID; this program reads
// that window's bounds and posts input only at coordinates derived from it.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

private enum Action: String {
    case dragUp = "drag-up"
    case dragDown = "drag-down"
    case scrollUp = "scroll-up"
    case scrollDown = "scroll-down"
}

private func fail(_ message: String, _ status: Int32 = 2) -> Never {
    FileHandle.standardError.write(Data("terminal-drawer-gesture: \(message)\n".utf8))
    exit(status)
}

private var args = Array(CommandLine.arguments.dropFirst())
private var windowID: CGWindowID?
private var action: Action?
private var amount: Int?
private var drawerHeight = 360

while !args.isEmpty {
    let argument = args.removeFirst()
    if argument == "--window-id" {
        guard let value = args.first, let parsed = UInt32(value) else {
            fail("--window-id needs a numeric CGWindowID")
        }
        args.removeFirst()
        windowID = parsed
    } else if argument == "--drawer-height" {
        guard let value = args.first, let parsed = Int(value), parsed > 0 else {
            fail("--drawer-height needs a positive pixel height")
        }
        args.removeFirst()
        drawerHeight = parsed
    } else if let parsed = Action(rawValue: argument) {
        guard action == nil, let value = args.first, let parsedAmount = Int(value), parsedAmount > 0 else {
            fail("\(argument) needs one positive pixel or row count")
        }
        args.removeFirst()
        action = parsed
        amount = parsedAmount
    } else {
        fail("unknown argument \(argument)")
    }
}

guard let windowID, let action, let amount else {
    fail("usage: terminal-drawer-gesture --window-id <id> [--drawer-height <px>] drag-up|drag-down|scroll-up|scroll-down <amount>")
}

guard AXIsProcessTrusted() else {
    fail("Accessibility permission is required to drive the proof-owned window", 77)
}

let windowOptions: CGWindowListOption = [.optionIncludingWindow, .excludeDesktopElements]
guard
    let windows = CGWindowListCopyWindowInfo(windowOptions, windowID) as? [[String: Any]],
    let window = windows.first,
    let boundsDictionary = window[kCGWindowBounds as String] as? [String: NSNumber],
    let boundsX = boundsDictionary["X"],
    let boundsY = boundsDictionary["Y"],
    let boundsWidth = boundsDictionary["Width"],
    let boundsHeight = boundsDictionary["Height"],
    let ownerPID = window[kCGWindowOwnerPID as String] as? NSNumber
else {
    fail("window \(windowID) is not available", 3)
}

let bounds = CGRect(
    x: boundsX.doubleValue,
    y: boundsY.doubleValue,
    width: boundsWidth.doubleValue,
    height: boundsHeight.doubleValue
)

_ = NSRunningApplication(processIdentifier: ownerPID.int32Value)?.activate(options: [
    .activateAllWindows,
])

// Multiple pd-console lanes can share a process name and overlap exactly. A
// CGWindowID scopes capture but not global pointer delivery, so explicitly
// raise this proof process's native window before sending any event.
let axApplication = AXUIElementCreateApplication(ownerPID.int32Value)
_ = AXUIElementSetAttributeValue(
    axApplication,
    kAXFrontmostAttribute as CFString,
    kCFBooleanTrue
)
var axWindowsValue: CFTypeRef?
if AXUIElementCopyAttributeValue(
    axApplication,
    kAXWindowsAttribute as CFString,
    &axWindowsValue
) == .success,
   let axWindows = axWindowsValue as? [AXUIElement],
   let axWindow = axWindows.first
{
    _ = AXUIElementPerformAction(axWindow, kAXRaiseAction as CFString)
}
Thread.sleep(forTimeInterval: 0.35)

private let source = CGEventSource(stateID: .combinedSessionState)

/// Post one pointer event at an exact global point and briefly yield so GPUI
/// receives each authored drag frame rather than one coalesced teleport.
private func postPointer(_ type: CGEventType, at point: CGPoint) {
    guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
        fail("could not construct \(type.rawValue) pointer event", 4)
    }
    event.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.035)
}

/// Drag the named top edge of the default 360px bottom drawer by `pixels`.
///
/// The constants mirror `app.rs`: 64px bottom chrome and a 12px resize handle.
/// `--drawer-height` lets a proof perform a second gesture after the first one
/// moves the edge. It defaults to the fresh-process 360px geometry.
private func dragDrawer(upward: Bool, pixels: Int) {
    let start = CGPoint(
        x: bounds.midX,
        y: bounds.maxY - 64.0 - CGFloat(drawerHeight) + 6.0
    )
    // CGEvent's global display coordinates increase downward here, matching
    // GPUI's normalized top-down window `y`. The PTY row assertions in the
    // caller fail closed if this platform convention ever changes.
    let signedDistance = CGFloat(upward ? -pixels : pixels)
    let end = CGPoint(x: start.x, y: start.y + signedDistance)
    postPointer(.mouseMoved, at: start)
    postPointer(.leftMouseDown, at: start)
    guard CGAssociateMouseAndMouseCursorPosition(0) == .success else {
        postPointer(.leftMouseUp, at: start)
        fail("could not isolate the held proof cursor", 4)
    }
    defer {
        CGAssociateMouseAndMouseCursorPosition(1)
    }
    let steps = max(8, min(24, pixels / 8))
    for step in 1 ... steps {
        let progress = CGFloat(step) / CGFloat(steps)
        let point = CGPoint(
            x: start.x,
            y: start.y + (end.y - start.y) * progress
        )
        postPointer(.leftMouseDragged, at: point)
    }
    postPointer(.leftMouseUp, at: end)
}

/// Send discrete wheel rows inside the drawer's output region.
///
/// The point is anchored above the fixed footer, so it remains inside output at
/// every allowed drawer height. Positive macOS wheel deltas mean "toward older
/// content," matching the `ShellTerminal::scroll_wheel_pixels` contract.
private func scrollDrawer(upward: Bool, rows: Int) {
    let point = CGPoint(
        x: bounds.midX,
        y: bounds.maxY - 64.0 - 28.0 - 72.0
    )
    postPointer(.mouseMoved, at: point)
    let delta: Int32 = upward ? 1 : -1
    for _ in 0 ..< rows {
        guard let event = CGEvent(
            scrollWheelEvent2Source: source,
            units: .line,
            wheelCount: 1,
            wheel1: delta,
            wheel2: 0,
            wheel3: 0
        ) else {
            fail("could not construct scroll event", 4)
        }
        event.location = point
        event.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.045)
    }
}

switch action {
case .dragUp:
    dragDrawer(upward: true, pixels: amount)
case .dragDown:
    dragDrawer(upward: false, pixels: amount)
case .scrollUp:
    scrollDrawer(upward: true, rows: amount)
case .scrollDown:
    scrollDrawer(upward: false, rows: amount)
}
