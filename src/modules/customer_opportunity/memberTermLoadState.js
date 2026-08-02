/** Coordinates member-term requests without coupling different opportunities
 * through one global in-flight lock. Only the newest token may commit state. */
export function createMemberTermLoadState() {
  let sequence = 0
  return {
    begin(opportunityID) {
      return { sequence: ++sequence, opportunityID: Number(opportunityID) }
    },
    isCurrent(token, selectedOpportunityID) {
      return token?.sequence === sequence && token.opportunityID === Number(selectedOpportunityID)
    },
  }
}
