// AI agents can recommend, but they can never approve, cancel, confirm or change inventory. A human decides.
forbid(principal is Agent, action in [Action::"ApprovePlan", Action::"CancelEmergency", Action::"AcknowledgeRequest", Action::"UpdateInventory", Action::"SetResourceStatus", Action::"ResetDemo"], resource);
