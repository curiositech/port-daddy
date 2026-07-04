#!/usr/bin/env swift
import CoreGraphics
import Foundation

let ownerName = CommandLine.arguments.dropFirst().first ?? "pd-console"
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]

guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    exit(1)
}

var bestWindowId: Int?
var bestArea = 0.0

for window in windows {
    guard let owner = window[kCGWindowOwnerName as String] as? String, owner == ownerName else {
        continue
    }
    guard let number = window[kCGWindowNumber as String] as? NSNumber else {
        continue
    }
    guard let bounds = window[kCGWindowBounds as String] as? [String: Any] else {
        continue
    }
    let width = (bounds["Width"] as? NSNumber)?.doubleValue ?? 0
    let height = (bounds["Height"] as? NSNumber)?.doubleValue ?? 0
    let area = width * height
    if area > bestArea {
        bestArea = area
        bestWindowId = number.intValue
    }
}

guard let bestWindowId, bestArea > 0 else {
    exit(1)
}

print(bestWindowId)
