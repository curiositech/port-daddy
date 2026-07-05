#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsoleCliArgs {
    pub initial_pane: Option<String>,
    pub display_selector: Option<String>,
    pub list_displays: bool,
}

pub fn parse_console_args<I, S>(args: I) -> ConsoleCliArgs
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let args: Vec<String> = args.into_iter().map(|a| a.as_ref().to_string()).collect();
    ConsoleCliArgs {
        initial_pane: value_after(&args, "--pane"),
        display_selector: value_after(&args, "--display"),
        list_displays: args.iter().any(|a| a == "--list-displays"),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisplaySelection<T> {
    pub display_id: Option<T>,
    pub warning: Option<String>,
}

pub fn resolve_display_selector<T: Clone>(
    selector: Option<&str>,
    displays: &[(T, Option<String>)],
) -> DisplaySelection<T> {
    let Some(sel) = selector else {
        return DisplaySelection {
            display_id: None,
            warning: None,
        };
    };

    if let Ok(idx) = sel.parse::<usize>() {
        if let Some((id, _)) = displays.get(idx) {
            return DisplaySelection {
                display_id: Some(id.clone()),
                warning: None,
            };
        }
        return DisplaySelection {
            display_id: None,
            warning: Some(format!(
                "pd-console: --display {idx} out of range ({} display(s)); using primary",
                displays.len()
            )),
        };
    }

    for (id, uuid) in displays {
        if uuid.as_deref().is_some_and(|u| u.eq_ignore_ascii_case(sel)) {
            return DisplaySelection {
                display_id: Some(id.clone()),
                warning: None,
            };
        }
    }

    DisplaySelection {
        display_id: None,
        warning: Some(format!(
            "pd-console: --display '{sel}' matched no display; using primary"
        )),
    }
}

fn value_after(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1).cloned())
}
