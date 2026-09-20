// Facility staff, and their connected systems, may update only their own facility's inventory.
permit(principal, action == Action::"UpdateInventory", resource is Facility)
when { (principal.role == "facility_admin" || principal.role == "facility_system") && principal.facility == resource.facility };
