import asyncio
import httpx

async def main():
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        # 1. Login (OAuth2 패스워드 방식 토큰 발급 후 헤더 추가)
        login_res = await client.post(
            "/api/v1/auth/login",
            json={"email": "dev@geobim.local", "password": "dev"}
        )
        token = login_res.json().get("access_token")
        headers = {"Authorization": f"Bearer {token}"}
        
        # 2. Get projects
        proj_res = await client.get("/api/v1/projects", headers=headers)
        projects = proj_res.json()
        print(f"Total Projects: {len(projects)}")
        
        if len(projects) > 0:
            target_proj = projects[0]
            print(f"Testing Project: {target_proj['name']} (ID: {target_proj['id']})")
            
            # 3. Get boreholes
            bh_res = await client.get(
                f"/api/v1/boreholes?project_id={target_proj['id']}&include_strata=true",
                headers=headers
            )
            data = bh_res.json()
            boreholes = data.get("boreholes", [])
            print(f"Total Boreholes: {len(boreholes)}")
            
            # 4. 각 시추공별 strata 상태 분석
            print("\n----- API BOREHOLES STRATA DETAILS -----")
            for b in boreholes[:10]: # 상위 10개 시추공 분석
                strata = b.get("strata", [])
                print(f"BH Name: {b['name']} (ID: {b['id']}) | Strata Count: {len(strata)}")
                for idx, s in enumerate(strata):
                    print(f"  -> Seg {idx+1}: Top {s['depth_top']}m ~ Bot {s['depth_bottom']}m | Strata Group: {s['strata_group']} | Soil Type: {s['soil_type']}")

if __name__ == "__main__":
    asyncio.run(main())
