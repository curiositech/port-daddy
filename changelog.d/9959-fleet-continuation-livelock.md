type: fixed

- **Fleet now stops repeated checkpoint continuations before they can loop for hours.** Two identical completed-ship and remaining-roster receipts terminate the run neutral before another model call, with a durable livelock explanation on the run page.
