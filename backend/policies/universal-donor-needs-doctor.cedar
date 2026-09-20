// O-negative blood is scarce: a dispatch lead cannot approve plans that use it; a duty doctor must.
forbid(principal is User, action == Action::"ApprovePlan", resource is Plan)
when { resource.usesUniversalDonorBlood && principal.role == "dispatch_lead" };
