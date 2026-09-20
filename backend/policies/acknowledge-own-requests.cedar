// A facility answers (accepts or declines) only the requests addressed to it.
permit(principal is User, action == Action::"AcknowledgeRequest", resource is Facility)
when { principal.role == "facility_admin" && principal.facility == resource.facility };
