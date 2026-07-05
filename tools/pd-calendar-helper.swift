/**
 * pd-calendar-helper — tiny EventKit CLI the fleet calendar channel shells
 * out to (compiled on demand by lib/fleet/calendar-eventkit.ts into
 * ~/.port-daddy/bin/pd-calendar-helper).
 *
 * Commands:
 *   status                       → {"authorized":bool,"state":"..."}   (never prompts)
 *   request-access               → runs the TCC prompt, prints status
 *   list <fromISO> <toISO> [cal] → JSON array of event instances
 *   create <json>                → {"id":"..."}; json = {title,start,end,
 *                                  calendar?,location?,notes?} (ISO-8601)
 *
 * Contracts the daemon relies on (agentic-calendar-coordination gates):
 *   - All emitted timestamps are ISO-8601 UTC. Conversion to local zones
 *     happens at display boundaries only.
 *   - Recurring events are expanded to INSTANCES by EventKit's predicate;
 *     each instance id is eventIdentifier + "/" + startUTC so dedup and
 *     conflict logic operate per-occurrence, never per-series.
 *   - Data minimization: `list` NEVER prints notes/description or attendee
 *     emails. Title/time/location/organizer only — the organizer address
 *     is needed by the daemon's trust-gate allowlist matching.
 */

import EventKit
import Foundation

let store = EKEventStore()

func isoUTC(_ date: Date) -> String {
  let fmt = ISO8601DateFormatter()
  fmt.formatOptions = [.withInternetDateTime]
  fmt.timeZone = TimeZone(identifier: "UTC")
  return fmt.string(from: date)
}

func parseISO(_ s: String) -> Date? {
  let fmt = ISO8601DateFormatter()
  fmt.formatOptions = [.withInternetDateTime]
  if let d = fmt.date(from: s) { return d }
  fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return fmt.date(from: s)
}

func jsonString(_ obj: Any) -> String {
  guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
        let str = String(data: data, encoding: .utf8) else {
    return "{}"
  }
  return str
}

func authState() -> (authorized: Bool, state: String) {
  let status = EKEventStore.authorizationStatus(for: .event)
  switch status {
  case .authorized: return (true, "authorized")
  case .fullAccess: return (true, "fullAccess")
  case .writeOnly: return (false, "writeOnly")
  case .denied: return (false, "denied")
  case .restricted: return (false, "restricted")
  case .notDetermined: return (false, "notDetermined")
  @unknown default: return (false, "unknown")
  }
}

func requestAccess() -> Bool {
  let semaphore = DispatchSemaphore(value: 0)
  var granted = false
  if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { ok, _ in granted = ok; semaphore.signal() }
  } else {
    store.requestAccess(to: .event) { ok, _ in granted = ok; semaphore.signal() }
  }
  _ = semaphore.wait(timeout: .now() + 120)
  return granted
}

func organizerEmail(_ event: EKEvent) -> String? {
  guard let organizer = event.organizer else { return nil }
  let url = organizer.url
  if url.scheme == "mailto" {
    return url.absoluteString.replacingOccurrences(of: "mailto:", with: "")
  }
  return organizer.name
}

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else {
  FileHandle.standardError.write("usage: pd-calendar-helper <status|request-access|list|create> ...\n".data(using: .utf8)!)
  exit(2)
}

switch command {
case "status":
  let (authorized, state) = authState()
  print(jsonString(["authorized": authorized, "state": state]))

case "request-access":
  let granted = requestAccess()
  let (_, state) = authState()
  print(jsonString(["authorized": granted, "state": state]))

case "list":
  guard args.count >= 3, let from = parseISO(args[1]), let to = parseISO(args[2]) else {
    FileHandle.standardError.write("usage: pd-calendar-helper list <fromISO> <toISO> [calendarName]\n".data(using: .utf8)!)
    exit(2)
  }
  let (authorized, state) = authState()
  guard authorized else {
    FileHandle.standardError.write("calendar access not granted (state: \(state)); run request-access\n".data(using: .utf8)!)
    exit(3)
  }
  let calendarFilter: String? = args.count >= 4 ? args[3] : nil
  var calendars = store.calendars(for: .event)
  if let name = calendarFilter {
    calendars = calendars.filter { $0.title == name }
  }
  // predicateForEvents expands recurring events into per-occurrence
  // instances — the load-bearing "expand before dedup/conflict" gate.
  let predicate = store.predicateForEvents(withStart: from, end: to, calendars: calendars.isEmpty ? nil : calendars)
  let events = store.events(matching: predicate)
  var out: [[String: Any]] = []
  for ev in events {
    guard let start = ev.startDate, let end = ev.endDate else { continue }
    let seriesId = ev.eventIdentifier ?? "unknown"
    var item: [String: Any] = [
      "id": "\(seriesId)/\(isoUTC(start))",   // instance-unique
      "seriesId": seriesId,
      "title": ev.title ?? "",
      "start": isoUTC(start),
      "end": isoUTC(end),
      "allDay": ev.isAllDay,
      "calendar": ev.calendar?.title ?? "",
      "recurring": ev.hasRecurrenceRules,
    ]
    if let location = ev.location, !location.isEmpty { item["location"] = location }
    if let organizer = organizerEmail(ev) { item["organizer"] = organizer }
    if let url = ev.url?.absoluteString { item["conferenceUrl"] = url }
    out.append(item)
  }
  print(jsonString(out))

case "create":
  guard args.count >= 2,
        let data = args[1].data(using: .utf8),
        let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let title = obj["title"] as? String,
        let startStr = obj["start"] as? String, let start = parseISO(startStr),
        let endStr = obj["end"] as? String, let end = parseISO(endStr) else {
    FileHandle.standardError.write("usage: pd-calendar-helper create '{\"title\":...,\"start\":ISO,\"end\":ISO,...}'\n".data(using: .utf8)!)
    exit(2)
  }
  let (authorized, state) = authState()
  guard authorized else {
    FileHandle.standardError.write("calendar access not granted (state: \(state)); run request-access\n".data(using: .utf8)!)
    exit(3)
  }
  let event = EKEvent(eventStore: store)
  event.title = title
  event.startDate = start
  event.endDate = end
  if let location = obj["location"] as? String { event.location = location }
  if let notes = obj["notes"] as? String { event.notes = notes }
  if let calendarName = obj["calendar"] as? String,
     let cal = store.calendars(for: .event).first(where: { $0.title == calendarName }) {
    event.calendar = cal
  } else {
    event.calendar = store.defaultCalendarForNewEvents
  }
  do {
    try store.save(event, span: .thisEvent, commit: true)
    print(jsonString(["id": event.eventIdentifier ?? "unknown", "calendar": event.calendar?.title ?? ""]))
  } catch {
    FileHandle.standardError.write("save failed: \(error.localizedDescription)\n".data(using: .utf8)!)
    exit(4)
  }

default:
  FileHandle.standardError.write("unknown command: \(command)\n".data(using: .utf8)!)
  exit(2)
}
