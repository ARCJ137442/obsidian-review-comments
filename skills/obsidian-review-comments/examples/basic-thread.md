# Basic Thread

The paragraph contains {an anchored phrase}{>>author=Human;date=2026-06-09;type=ASK;id=RC-20260609-120000-ABCD: Can this be clearer?<<}{>>author=Agent;date=2026-06-09;type=NOTE;id=RC-20260609-120100-EFGH: I will rewrite only this phrase and keep the rest unchanged.<<} in the middle of normal prose.

Expected agent behavior:

- Recognize one anchor with two linear entries.
- Treat the second entry as a reply to the first.
- Do not duplicate the anchor when adding another reply.
