import asyncio
import httpx

async def main():
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        # 1. Login
        login_res = await client.post(
            "/api/v1/auth/login",
            json={"email": "dev@geobim.local", "password": "dev"}
        )
        print("Login Status:", login_res.status_code)
        print("Login Response:", login_res.json())
        
        # 2. Get projects
        proj_res = await client.get("/api/v1/projects")
        print("\nProjects Status:", proj_res.status_code)
        projects = proj_res.json()
        print(f"Total Projects found: {len(projects)}")
        if len(projects) > 0:
            target_proj = projects[0]
            print("First Project Name:", target_proj["name"])
            print("First Project ID:", target_proj["id"])
            
            # 3. Get boreholes for this project
            bh_res = await client.get(f"/api/v1/boreholes?project_id={target_proj['id']}")
            print("\nBoreholes Status:", bh_res.status_code)
            boreholes = bh_res.json()
            print(f"Total Boreholes in project {target_proj['name']}: {len(boreholes)}")
            if len(boreholes) > 0:
                target_bh = boreholes[0]
                print("First Borehole Name:", target_bh["name"])
                print("First Borehole Strata count:", len(target_bh.get("strata", [])))
                if len(target_bh.get("strata", [])) > 0:
                    stratum = target_bh["strata"][0]
                    print("\nFirst Stratum details:")
                    print("- Depth top:", stratum.get("depth_top"))
                    print("- Depth bottom:", stratum.get("depth_bottom"))
                    print("- Raw text (soil_type):", stratum.get("raw_text"))
                    print("- n_value:", stratum.get("n_value"))
                    print("- uscs_code:", stratum.get("uscs_code"))

if __name__ == "__main__":
    asyncio.run(main())
