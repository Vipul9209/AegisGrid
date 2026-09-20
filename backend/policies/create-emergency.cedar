// Duty doctors, dispatch leads and the AI agent may open an emergency.
permit(principal, action == Action::"CreateEmergency", resource is Network)
when { principal.role == "duty_doctor" || principal.role == "dispatch_lead" || principal.role == "ai_agent" };
