// Only clinical leads may reset the demo network.
permit(principal is User, action == Action::"ResetDemo", resource is Network)
when { principal.role == "duty_doctor" || principal.role == "dispatch_lead" };
