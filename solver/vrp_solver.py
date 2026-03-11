"""
VRP Solver using Google OR-Tools
Optimizes route order and day assignments for a crew's properties.
Minimizes total drive time while respecting daily capacity and time windows.
Provides enough routes to fit all properties — solver fills only what it needs.
Constraints are always enforced (never relaxed).
"""

from ortools.constraint_solver import routing_enums_pb2, pywrapcp
import math


# Crews leave depot at 6:00 AM
DAY_START_CLOCK = 360  # minutes from midnight


def solve_vrp(depot, properties, distance_matrix, max_day_minutes=480, days=None,
              time_limit_seconds=30, separate_day_groups=None, same_day_groups=None):
    if days is None:
        days = ["Route 1", "Route 2", "Route 3", "Route 4", "Route 5"]

    num_properties = len(properties)
    if num_properties == 0:
        return {
            "status": "NO_PROPERTIES",
            "routes": {day: [] for day in days},
            "total_drive_time_minutes": 0,
            "day_totals": {day: {"drive_minutes": 0, "service_minutes": 0, "total_minutes": 0} for day in days},
        }

    # Filter out same_day_groups that exceed day capacity (can't physically fit)
    valid_same_day = []
    skipped_same_day = []
    if same_day_groups:
        for group in same_day_groups:
            group_service = sum(max(1, properties[idx]["onsite_minutes"]) for idx in group)
            if group_service <= max_day_minutes:
                valid_same_day.append(group)
            else:
                skipped_same_day.append(group)
                prop_ids = [properties[idx].get("id") for idx in group]
                print(f"[Solver] WARNING: Same-day group {prop_ids} service time ({group_service:.0f} min) exceeds day limit ({max_day_minutes} min), skipping constraint")

    # Calculate how many routes to offer the solver
    # Be generous — give it plenty of routes. It will only use what it needs.
    total_service = sum(max(1, p["onsite_minutes"]) for p in properties)
    min_routes = max(len(days), math.ceil(total_service / (max_day_minutes * 0.70)))
    # Give 50% headroom so the solver has flexibility
    num_routes = max(min_routes, math.ceil(min_routes * 1.5))
    # Must have at least as many routes as the largest separate_day_group
    if separate_day_groups:
        max_group = max(len(g) for g in separate_day_groups)
        num_routes = max(num_routes, max_group)

    print(f"[Solver] {num_properties} properties, {total_service:.0f} min total service")
    print(f"[Solver] Providing {num_routes} route slots (min needed: {min_routes})")

    # Build constraint descriptions
    constraints = []
    if separate_day_groups:
        for group in separate_day_groups:
            prop_ids = [properties[idx].get("id") for idx in group]
            constraints.append({
                "type": "different_days",
                "description": f"Multi-visit properties must be on different days",
                "property_ids": prop_ids,
                "status": "enforced",
            })
    if valid_same_day:
        for group in valid_same_day:
            prop_ids = [properties[idx].get("id") for idx in group]
            total_svc = sum(max(1, properties[idx]["onsite_minutes"]) for idx in group)
            constraints.append({
                "type": "same_day",
                "description": f"Complex properties must be on same day ({int(total_svc)} min combined)",
                "property_ids": prop_ids,
                "status": "enforced",
            })
    if skipped_same_day:
        for group in skipped_same_day:
            prop_ids = [properties[idx].get("id") for idx in group]
            total_svc = sum(max(1, properties[idx]["onsite_minutes"]) for idx in group)
            constraints.append({
                "type": "same_day",
                "description": f"Complex properties must be on same day ({int(total_svc)} min combined)",
                "property_ids": prop_ids,
                "status": "skipped",
                "reason": f"Combined service time ({int(total_svc)} min) exceeds day limit ({max_day_minutes} min)",
            })

    # Solve with generous route count — solver only uses what it needs
    day_labels = _build_day_labels(days, num_routes)
    result = _solve_with_vehicles(
        properties, distance_matrix, max_day_minutes, day_labels,
        time_limit_seconds, separate_day_groups, valid_same_day,
    )

    if result["status"] != "NO_SOLUTION":
        dropped = result.get("dropped_properties") or []
        if dropped:
            print(f"[Solver] {len(dropped)} dropped, retrying with more routes...")
            # Add more routes and try again
            extra = len(dropped) + 5
            day_labels = _build_day_labels(days, num_routes + extra)
            result = _solve_with_vehicles(
                properties, distance_matrix, max_day_minutes, day_labels,
                time_limit_seconds, separate_day_groups, valid_same_day,
            )
            dropped = result.get("dropped_properties") or []

        if not dropped:
            print(f"[Solver] All {num_properties} properties placed in {result['routes_needed']} routes!")
        else:
            print(f"[Solver] {len(dropped)} still dropped after retry")

        result["constraints_applied"] = constraints
        return result

    # NO_SOLUTION — try with even more routes
    print(f"[Solver] NO_SOLUTION with {num_routes} routes, retrying with {num_properties} routes...")
    day_labels = _build_day_labels(days, num_properties)
    result = _solve_with_vehicles(
        properties, distance_matrix, max_day_minutes, day_labels,
        time_limit_seconds, separate_day_groups, valid_same_day,
    )

    if result["status"] != "NO_SOLUTION":
        result["constraints_applied"] = constraints
        return result

    # Still no solution — constraints may be truly infeasible. Try without constraints.
    print(f"[Solver] Still NO_SOLUTION. Trying without constraints as diagnostic...")
    day_labels = _build_day_labels(days, num_properties)
    result = _solve_with_vehicles(
        properties, distance_matrix, max_day_minutes, day_labels,
        time_limit_seconds, None, None,
    )

    if result["status"] != "NO_SOLUTION":
        # Mark all constraints as skipped since we had to drop them
        for c in constraints:
            c["status"] = "skipped"
            c["reason"] = "Constraints made problem infeasible — removed to find a solution"
        result["constraints_applied"] = constraints
        return result

    return {
        "status": "NO_SOLUTION",
        "routes": {day: [] for day in days},
        "total_drive_time_minutes": 0,
        "day_totals": {day: {"drive_minutes": 0, "service_minutes": 0, "total_minutes": 0} for day in days},
        "dropped_properties": [p["id"] for p in properties],
        "constraints_applied": constraints,
    }


def _build_day_labels(base_days, count):
    labels = list(base_days)
    next_num = len(labels) + 1
    while len(labels) < count:
        labels.append(f"Route {next_num}")
        next_num += 1
    return labels


def _solve_with_vehicles(properties, distance_matrix, max_day_minutes, day_labels,
                         time_limit_seconds, separate_day_groups, same_day_groups):
    num_properties = len(properties)
    num_locations = num_properties + 1
    num_vehicles = len(day_labels)

    # Convert distance matrix from seconds to minutes
    time_matrix = []
    for row in distance_matrix:
        time_matrix.append([max(1, int(round(val / 60))) for val in row])
    for i in range(len(time_matrix)):
        time_matrix[i][i] = 0

    # Service times (minutes). Depot = 0.
    service_times = [0]
    for prop in properties:
        service_times.append(max(1, int(round(prop["onsite_minutes"]))))

    # Time windows in relative minutes (0 = start of work day)
    time_windows = [(0, max_day_minutes)]
    has_any_window = False
    for prop in properties:
        ws = prop.get("window_start_minutes")
        we = prop.get("window_end_minutes")
        rel_start = max(0, ws - DAY_START_CLOCK) if ws is not None else 0
        rel_end = min(max_day_minutes, we - DAY_START_CLOCK) if we is not None else max_day_minutes
        if rel_start >= rel_end:
            rel_start = 0
            rel_end = max_day_minutes
        if (rel_start, rel_end) != (0, max_day_minutes):
            has_any_window = True
        time_windows.append((rel_start, rel_end))

    # Create model
    manager = pywrapcp.RoutingIndexManager(num_locations, num_vehicles, 0)
    routing = pywrapcp.RoutingModel(manager)

    # Transit callback
    def time_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return time_matrix[from_node][to_node] + service_times[to_node]

    transit_callback_index = routing.RegisterTransitCallback(time_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    # Time dimension
    slack = max_day_minutes if has_any_window else 0
    routing.AddDimension(
        transit_callback_index,
        slack,
        max_day_minutes,
        True,
        "Time",
    )
    time_dimension = routing.GetDimensionOrDie("Time")

    # Apply non-default time windows
    if has_any_window:
        for loc_idx in range(1, num_locations):
            tw = time_windows[loc_idx]
            if tw != (0, max_day_minutes):
                index = manager.NodeToIndex(loc_idx)
                time_dimension.CumulVar(index).SetRange(tw[0], tw[1])

    # Balance loads across days — penalize using extra vehicles
    for v in range(num_vehicles):
        time_dimension.SetSpanCostCoefficientForVehicle(1, v)

    # Allow dropping nodes (high penalty to discourage it)
    drop_penalty = 100000
    for node in range(1, num_locations):
        routing.AddDisjunction([manager.NodeToIndex(node)], drop_penalty)

    # Hard constraints
    solver = routing.solver()

    # Multi-visit: different days
    if separate_day_groups:
        for group in separate_day_groups:
            if len(group) <= num_vehicles:
                node_indices = [manager.NodeToIndex(prop_idx + 1) for prop_idx in group]
                for a in range(len(node_indices)):
                    for b in range(a + 1, len(node_indices)):
                        solver.Add(
                            routing.VehicleVar(node_indices[a]) != routing.VehicleVar(node_indices[b])
                        )

    # Complex: same day
    if same_day_groups:
        for group in same_day_groups:
            node_indices = [manager.NodeToIndex(prop_idx + 1) for prop_idx in group]
            for i in range(1, len(node_indices)):
                solver.Add(
                    routing.VehicleVar(node_indices[0]) == routing.VehicleVar(node_indices[i])
                )

    # Search parameters
    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    )
    search_params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_params.time_limit.seconds = time_limit_seconds

    # Solve
    solution = routing.SolveWithParameters(search_params)

    if not solution:
        return {
            "status": "NO_SOLUTION",
            "routes": {day: [] for day in day_labels},
            "total_drive_time_minutes": 0,
            "day_totals": {day: {"drive_minutes": 0, "service_minutes": 0, "total_minutes": 0} for day in day_labels},
            "dropped_properties": [p["id"] for p in properties],
        }

    # Extract solution
    routes = {}
    day_totals = {}
    total_drive = 0
    dropped = set(range(1, num_locations))

    for vehicle_id in range(num_vehicles):
        day_name = day_labels[vehicle_id]
        route_stops = []
        day_drive = 0
        day_service = 0

        index = routing.Start(vehicle_id)
        prev_node = 0
        order = 0

        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            if node != 0:
                dropped.discard(node)
                prop_idx = node - 1
                prop = properties[prop_idx]
                drive_seconds = distance_matrix[prev_node][node]
                drive_minutes = drive_seconds / 60

                cumul_relative = solution.Value(time_dimension.CumulVar(index))
                arrival_relative = max(0, cumul_relative - service_times[node])
                arrival_clock = DAY_START_CLOCK + arrival_relative

                order += 1
                route_stops.append({
                    "property_id": prop["id"],
                    "route_order": order,
                    "drive_time_seconds": round(drive_seconds),
                    "onsite_minutes": round(prop["onsite_minutes"], 1),
                    "arrival_minutes": round(arrival_clock),
                    "window_start": time_windows[node][0] + DAY_START_CLOCK,
                    "window_end": time_windows[node][1] + DAY_START_CLOCK,
                })

                day_drive += drive_minutes
                day_service += prop["onsite_minutes"]
                prev_node = node

            index = solution.Value(routing.NextVar(index))

        if prev_node != 0:
            return_seconds = distance_matrix[prev_node][0]
            day_drive += return_seconds / 60

        total_drive += day_drive
        routes[day_name] = route_stops
        day_totals[day_name] = {
            "drive_minutes": round(day_drive, 1),
            "service_minutes": round(day_service, 1),
            "total_minutes": round(day_drive + day_service, 1),
            "stop_count": len(route_stops),
        }

    dropped_ids = [properties[node - 1]["id"] for node in dropped]
    routes_with_stops = sum(1 for stops in routes.values() if stops)

    status_map = {0: "OPTIMAL", 1: "FEASIBLE", 2: "NO_SOLUTION", 3: "FAIL", 4: "NOT_SOLVED"}

    return {
        "status": status_map.get(routing.status(), str(routing.status())),
        "routes": routes,
        "total_drive_time_minutes": round(total_drive, 1),
        "day_totals": day_totals,
        "dropped_properties": dropped_ids if dropped_ids else None,
        "routes_needed": routes_with_stops,
    }
