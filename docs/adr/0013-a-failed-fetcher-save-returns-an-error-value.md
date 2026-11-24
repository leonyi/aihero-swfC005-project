# A failed fetcher save returns an error value so it can show a toast

Our coding standard is that an action which cannot continue throws a response. A notification preference switch on `/settings` is the exception: when Knock fails to save the change, the action returns `{ preferenceError }` with status 502 instead of throwing. The switch saves through a fetcher in place, and a thrown response would replace the whole settings page with the error boundary. A returned value lets the card flip the switch back and show a toast, and the person can try again.

## Considered Options

- **Throw the 502 like every other failure.** Rejected: one flaky vendor call would take the person off the page they were editing, for a change they can simply retry.
- **Catch the thrown response in the component.** Rejected: a fetcher's thrown response goes to the route's error boundary, not back to the fetcher, so the card never sees it.

## Consequences

The exception covers only a save that fails at a third party, in a fetcher that edits in place. A request the person may not make (a category that doesn't apply to them) still throws its 403, and so does every failure from a full-page form. A new fetcher save that wants a toast must add itself here rather than quietly return an error shape.
