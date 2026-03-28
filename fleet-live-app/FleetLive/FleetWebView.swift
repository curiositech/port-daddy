import SwiftUI
import WebKit

struct FleetWebView: NSViewRepresentable {
    @ObservedObject var viewModel: FleetLiveViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(viewModel: viewModel)
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")

        // Disable scrollbars by injecting CSS
        let hideScrollbarsCSS = """
        ::-webkit-scrollbar { display: none !important; }
        body { -webkit-overflow-scrolling: touch; overflow: -moz-scrollbars-none; }
        """
        let script = WKUserScript(
            source: """
            var style = document.createElement('style');
            style.textContent = `\(hideScrollbarsCSS)`;
            document.head.appendChild(style);
            """,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        webView.configuration.userContentController.addUserScript(script)

        // Set dark background while loading
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor(red: 0.10, green: 0.10, blue: 0.18, alpha: 1.0).cgColor

        context.coordinator.webView = webView

        let url = URL(string: "http://localhost:9876/fleet-live.html")!
        webView.load(URLRequest(url: url))

        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        // Reload when the token changes
        if context.coordinator.lastReloadToken != viewModel.reloadToken {
            context.coordinator.lastReloadToken = viewModel.reloadToken
            let url = URL(string: "http://localhost:9876/fleet-live.html")!
            webView.load(URLRequest(url: url))
        }
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKNavigationDelegate {
        var viewModel: FleetLiveViewModel
        var webView: WKWebView?
        var lastReloadToken: UUID?

        init(viewModel: FleetLiveViewModel) {
            self.viewModel = viewModel
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { @MainActor in
                viewModel.handleNavigationSuccess()
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            Task { @MainActor in
                viewModel.handleNavigationError(error)
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            Task { @MainActor in
                viewModel.handleNavigationError(error)
            }
        }
    }
}
