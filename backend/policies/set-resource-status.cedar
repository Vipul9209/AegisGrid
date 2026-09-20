// Clinical leads may flag any resource offline; facility admins only their own facility's.
permit(principal is User, action == Action::"SetResourceStatus", resource is Resource)
when { principal.role == "duty_doctor" || principal.role == "dispatch_lead" || (principal.role == "facility_admin" && principal.facility == resource.facility) };
