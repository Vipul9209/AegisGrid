"""AegisGrid coordinator agent (Strands Agents SDK).

The agent can READ the network and PROPOSE plans. It has no approve/cancel tool,
and Cedar forbids the "Agent" principal from approving even if someone added one.

Run:  python aegis_agent.py "Critical trauma at Whitefield, O-neg blood, ICU, ventilator, 30 min"
Env:  AEGIS_API      backend URL (default http://localhost:8787)
      AEGIS_MODEL    "bedrock" (default) or "ollama"  (ollama = fully local, no AWS account)
      BEDROCK_MODEL_ID / OLLAMA_MODEL   model names
"""
import os
import sys

import requests
from strands import Agent, tool

API = os.environ.get("AEGIS_API", "http://localhost:8787") + "/api"


def _login() -> dict:
    """The agent is a normal account with the ai_agent role. Cedar forbids it from approving."""
    r = requests.post(
        f"{API}/auth/login",
        json={"username": os.environ.get("AEGIS_AGENT_USER", "agent"), "password": os.environ.get("AEGIS_AGENT_PASSWORD", "aegis@2026")},
        timeout=10,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


HEADERS = _login() if __name__ == "__main__" or os.environ.get("AEGIS_LOGIN_ON_IMPORT") else {}


@tool
def list_facilities() -> list:
    """List all facilities in the network with their ids and names."""
    return [{"id": f["id"], "name": f["name"]} for f in requests.get(f"{API}/facilities", headers=HEADERS, timeout=10).json()]


@tool
def network_status() -> dict:
    """Current free ICU beds, ventilators, ambulances and blood units across the network."""
    return requests.get(f"{API}/dashboard", headers=HEADERS, timeout=10).json()


@tool
def create_emergency_and_plan(description: str, origin_facility_id: str) -> dict:
    """Register an emergency and get ranked response plans (deterministic planner).

    Args:
        description: Plain-language description of the patient and needs, including any time limit.
        origin_facility_id: Facility id where the patient is now (use list_facilities).
    """
    r = requests.post(f"{API}/emergencies", json={"text": description, "originFacilityId": origin_facility_id}, headers=HEADERS, timeout=20).json()
    plans = (r.get("planning") or {}).get("plans", [])
    return {
        "emergencyId": r.get("id"),
        "requirements": r.get("requirements"),
        "plans": [
            {"name": p["name"], "id": p["id"], "site": p["targetName"], "minutes": p["responseMin"], "status": p["status"], "explanation": p["explanation"]}
            for p in plans
        ],
    }


@tool
def what_if_unavailable(emergency_id: str, resource_id: str) -> dict:
    """Simulate a resource becoming unavailable and report how the best plan changes. Read-only."""
    r = requests.post(f"{API}/emergencies/{emergency_id}/whatif", json={"exclude": [resource_id]}, headers=HEADERS, timeout=20).json()
    best = (r.get("plans") or [None])[0]
    return {"comparison": r.get("comparison"), "best": best and {"name": best["name"], "site": best["targetName"], "minutes": best["responseMin"], "status": best["status"]}}


SYSTEM = (
    "You are the AegisGrid coordinator. You help emergency teams assemble a response from fragmented hospital resources. "
    "Use the tools to register the emergency and read the plans. Never invent resources or times; only report what the tools return. "
    "You cannot approve plans: end by telling the human operator which plan you recommend and why, and that they must approve it in the command center. "
    "You give no medical advice."
)


def build_model():
    if os.environ.get("AEGIS_MODEL", "bedrock") == "ollama":
        from strands.models.ollama import OllamaModel

        return OllamaModel(host="http://localhost:11434", model_id=os.environ.get("OLLAMA_MODEL", "llama3.1"))
    from strands.models import BedrockModel

    return BedrockModel(model_id=os.environ["BEDROCK_MODEL_ID"]) if os.environ.get("BEDROCK_MODEL_ID") else BedrockModel()


agent = Agent(model=build_model(), system_prompt=SYSTEM, tools=[list_facilities, network_status, create_emergency_and_plan, what_if_unavailable]) if __name__ == "__main__" else None

if __name__ == "__main__":
    agent(" ".join(sys.argv[1:]) or "Critical trauma at Whitefield Community Hospital, needs O-negative blood, ICU, ventilator, ambulance and trauma specialist within 30 minutes.")
