// Duty doctors and dispatch leads may approve a plan, but only if it is feasible.
permit(principal is User, action == Action::"ApprovePlan", resource is Plan)
when { (principal.role == "duty_doctor" || principal.role == "dispatch_lead") && resource.feasible };
