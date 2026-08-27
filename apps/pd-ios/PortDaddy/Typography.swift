import SwiftUI
import UIKit
import CoreText

// MARK: - Typography — IBM Plex (design pass: binder ch20)
//
// The operator surface's type system: IBM Plex Sans for UI and prose, IBM Plex
// Mono for data — ages, costs, receipt ids, and the transcript tail, where
// tabular columns and a terminal lineage matter. This is the same family the
// ch20 skin uses on every other Port Daddy surface, so the phone does not speak
// a different typographic language from FleetBar or the console.
//
// The faces are bundled (PortDaddy/Resources/Fonts) and registered at launch;
// nothing here depends on the system having Plex installed. Sizes match Apple's
// default text-style metrics and scale with Dynamic Type via `relativeTo:`, so
// the 14pt floor and large-type accessibility both hold.

public enum PDFonts {
    // Idempotent one-time guard. Registration is only triggered from the
    // main-actor root init, and CTFontManager registration is itself
    // thread-safe, so the unchecked annotation is sound here.
    nonisolated(unsafe) private static var registered = false

    /// Register the bundled faces and stamp the nav-bar chrome. Idempotent;
    /// call from the root before the first view renders.
    public static func registerIfNeeded() {
        guard !registered else { return }
        registered = true

        var urls = Set<URL>()
        urls.formUnion(Bundle.module.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [])
        urls.formUnion(Bundle.module.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? [])
        for url in urls {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }

        applyNavBarChrome()
    }

    /// The large and inline navigation titles are UIKit-drawn, so they need a
    /// UINavigationBarAppearance rather than a SwiftUI `.font`.
    private static func applyNavBarChrome() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithDefaultBackground()
        appearance.largeTitleTextAttributes = [.font: uiFont(.bold, 34)]
        appearance.titleTextAttributes = [.font: uiFont(.semibold, 17)]
        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        UINavigationBar.appearance().compactAppearance = appearance
    }

    /// A weighted Plex Sans UIFont via the family + weight trait, so the correct
    /// instance is selected out of the variable face rather than a PostScript
    /// name that only exists for Regular.
    private static func uiFont(_ weight: UIFont.Weight, _ size: CGFloat) -> UIFont {
        let descriptor = UIFontDescriptor(fontAttributes: [
            .family: "IBM Plex Sans",
            .traits: [UIFontDescriptor.TraitKey.weight: weight],
        ])
        return UIFont(descriptor: descriptor, size: size)
    }
}

// MARK: - Role fonts

public enum PDFont {
    static func sans(_ style: Font.TextStyle, _ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        Font.custom("IBM Plex Sans", size: size, relativeTo: style).weight(weight)
    }
    static func mono(_ style: Font.TextStyle, _ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        Font.custom("IBM Plex Mono", size: size, relativeTo: style).weight(weight)
    }

    // Sans roles (sizes = Apple's default text-style metrics)
    public static let largeTitle  = sans(.largeTitle, 34, .bold)
    public static let title       = sans(.title, 28, .bold)
    public static let title2      = sans(.title2, 22, .semibold)
    public static let title3      = sans(.title3, 20, .semibold)
    public static let headline    = sans(.headline, 17, .semibold)
    public static let body        = sans(.body, 17)
    public static let callout     = sans(.callout, 16)
    public static let subheadline = sans(.subheadline, 15)
    public static let footnote    = sans(.footnote, 13)
    public static let caption     = sans(.caption, 12)
    public static let caption2    = sans(.caption2, 11)

    // Mono roles — data, ages, receipt ids, the transcript tail.
    public static let monoBody        = mono(.body, 17)
    public static let monoSubheadline = mono(.subheadline, 15)
    public static let monoCaption     = mono(.caption, 12)
}
