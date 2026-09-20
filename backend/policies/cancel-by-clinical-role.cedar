// Duty doctors and dispatch leads may cancel an emergency and release its resources.
permit(principal is User, action == Action::"CancelEmergency", resource is Emergency)
when { principal.role == "duty_doctor" || principal.role == "dispatch_lead" };
