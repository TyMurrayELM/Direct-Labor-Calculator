"""
FastAPI service wrapping the OR-Tools VRP solver.
Run: python -m uvicorn main:app --port 8001 --reload
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from vrp_solver import solve_vrp

app = FastAPI(title="Route Optimizer", version="1.0.0")


class Property(BaseModel):
    id: int
    lat: float
    lng: float
    onsite_minutes: float
    current_day: Optional[str] = None
    group: Optional[str] = None
    window_start_minutes: Optional[int] = None  # minutes from midnight
    window_end_minutes: Optional[int] = None


class Depot(BaseModel):
    lat: float
    lng: float


class SolveRequest(BaseModel):
    crew_id: int
    crew_size: int
    depot: Depot
    max_day_minutes: int = 480
    days: list[str] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    properties: list[Property]
    distance_matrix: list[list[float]]  # NxN, seconds
    time_limit_seconds: int = 30
    separate_day_groups: list[list[int]] = []  # groups of property indices that must be on different days
    same_day_groups: list[list[int]] = []  # groups of property indices that must be on the same day (complexes)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/solve")
def solve(req: SolveRequest):
    print(f"\n{'='*60}")
    print(f"[Solve] Received request: {len(req.properties)} properties, crew_id={req.crew_id}")
    print(f"[Solve] Matrix size: {len(req.distance_matrix)}x{len(req.distance_matrix[0]) if req.distance_matrix else 0}")
    print(f"[Solve] Days: {req.days}")
    print(f"[Solve] Separate day groups: {req.separate_day_groups}")
    print(f"[Solve] Same day groups: {req.same_day_groups}")

    n = len(req.properties) + 1  # +1 for depot
    if len(req.distance_matrix) != n:
        raise HTTPException(
            status_code=400,
            detail=f"Distance matrix size {len(req.distance_matrix)} doesn't match {n} locations (depot + {len(req.properties)} properties)",
        )

    props = [
        {
            "id": p.id,
            "lat": p.lat,
            "lng": p.lng,
            "onsite_minutes": p.onsite_minutes,
            "current_day": p.current_day,
            "window_start_minutes": p.window_start_minutes,
            "window_end_minutes": p.window_end_minutes,
        }
        for p in req.properties
    ]

    try:
        result = solve_vrp(
            depot={"lat": req.depot.lat, "lng": req.depot.lng},
            properties=props,
            distance_matrix=req.distance_matrix,
            max_day_minutes=req.max_day_minutes,
            days=req.days,
            time_limit_seconds=req.time_limit_seconds,
            separate_day_groups=req.separate_day_groups,
            same_day_groups=req.same_day_groups,
        )
        print(f"[Solve] Result: status={result.get('status')}, dropped={len(result.get('dropped_properties') or [])}, routes_needed={result.get('routes_needed')}")
        return result
    except Exception as e:
        print(f"[Solve] ERROR: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
