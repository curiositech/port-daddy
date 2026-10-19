import SwiftUI
import WebKit
import AppKit

struct FleetControlPlaneWebView: NSViewRepresentable {
    let url: URL
    let reloadToken: UUID
    @Binding var isLoading: Bool
    @Binding var errorMessage: String?

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let embedMarker = WKUserScript(
            source: "window.__PORT_DADDY_EMBED = 'fleetbar';",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        configuration.userContentController.addUserScript(embedMarker)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.customUserAgent = "PortDaddyFleetBar"
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsBackForwardNavigationGestures = false
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor.clear.cgColor

        context.coordinator.bind(isLoading: $isLoading, errorMessage: $errorMessage)
        context.coordinator.lastURL = url.absoluteString
        context.coordinator.lastReloadToken = reloadToken

        context.coordinator.watchLocalOff(webView)
        if LocalRuntimeControl.shared.blockedReason == nil {
            webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        }
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.bind(isLoading: $isLoading, errorMessage: $errorMessage)
        guard LocalRuntimeControl.shared.blockedReason == nil else {
            context.coordinator.blankForOff(webView)
            return
        }

        let nextURL = url.absoluteString
        let needsReload = context.coordinator.lastURL != nextURL || context.coordinator.lastReloadToken != reloadToken
        guard needsReload else { return }

        context.coordinator.lastURL = nextURL
        context.coordinator.lastReloadToken = reloadToken
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var lastURL: String?
        var lastReloadToken: UUID?
        private var isLoadingBinding: Binding<Bool>?
        private var errorBinding: Binding<String?>?
        private var offWatch: Task<Void, Never>?
        private var blankedForOff = false

        deinit { offWatch?.cancel() }

        func watchLocalOff(_ webView: WKWebView) {
            offWatch = Task { @MainActor [weak self, weak webView] in
                while !Task.isCancelled {
                    guard let webView else { return }
                    if LocalRuntimeControl.shared.blockedReason != nil {
                        self?.blankForOff(webView)
                        return
                    }
                    do { try await Task.sleep(for: .seconds(1)) } catch { return }
                }
            }
        }

        func blankForOff(_ webView: WKWebView) {
            guard !blankedForOff else { return }
            blankedForOff = true
            webView.stopLoading()
            // Stop an already-loaded dashboard's script timers as well as its
            // top-level navigation. In-flight requests are not revocable proof.
            webView.loadHTMLString("<!doctype html><title>Local Off</title>", baseURL: nil)
            errorBinding?.wrappedValue = LocalRuntimeControl.shared.blockedReason
            isLoadingBinding?.wrappedValue = false
        }

        func bind(isLoading: Binding<Bool>, errorMessage: Binding<String?>) {
            isLoadingBinding = isLoading
            errorBinding = errorMessage
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            errorBinding?.wrappedValue = nil
            isLoadingBinding?.wrappedValue = true
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            if let reason = LocalRuntimeControl.shared.blockedReason {
                errorBinding?.wrappedValue = reason
                isLoadingBinding?.wrappedValue = false
                decisionHandler(navigationAction.request.url?.absoluteString == "about:blank" ? .allow : .cancel)
                return
            }
            guard let requestURL = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if let host = requestURL.host, ["localhost", "127.0.0.1"].contains(host) {
                decisionHandler(.allow)
                return
            }

            if navigationAction.navigationType == .linkActivated {
                NSWorkspace.shared.open(requestURL)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            errorBinding?.wrappedValue = LocalRuntimeControl.shared.blockedReason
            isLoadingBinding?.wrappedValue = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            errorBinding?.wrappedValue = error.localizedDescription
            isLoadingBinding?.wrappedValue = false
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            errorBinding?.wrappedValue = error.localizedDescription
            isLoadingBinding?.wrappedValue = false
        }
    }
}
