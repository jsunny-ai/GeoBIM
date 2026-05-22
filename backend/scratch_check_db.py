import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

async def main():
    engine = create_async_engine('postgresql+asyncpg://geobim:geobim_dev_only@127.0.0.1:5432/geobim')
    async_session = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    
    async with async_session() as session:
        # 1. 특정 시추공 (예: H-78 등)의 strata 레코드와 depth를 봅니다.
        # 동일한 depth_top, depth_bottom을 가지는 strata가 중복 등록되어 있는지 확인합니다.
        result = await session.execute(text('''
            SELECT s.id, s.borehole_id, b.name, s.depth_top, s.depth_bottom, s.soil_type, count(*) OVER (PARTITION BY s.borehole_id, s.depth_top, s.depth_bottom) as dup_count
            FROM strata s
            JOIN boreholes b ON s.borehole_id = b.id
            ORDER BY dup_count DESC, b.name, s.depth_top
            LIMIT 40
        '''))
        rows = result.all()
        print("----- DB STRATA OVERLAP CHECK (중복 등록 확인) -----")
        for row in rows:
            print(f"StrataID: {row[0]} | BH_ID: {row[1]} | Name: {row[2]} | Top: {row[3]}m | Bot: {row[4]}m | Type: {row[5]} | DupCount: {row[6]}")

async def main2():
    # 2. 실제로 중복된 strata 레코드가 DB에 물리적으로 존재하는지, 즉 strata_id가 서로 다른데도 depth가 겹쳐서 들어있는지 확인
    engine = create_async_engine('postgresql+asyncpg://geobim:geobim_dev_only@127.0.0.1:5432/geobim')
    async_session = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with async_session() as session:
        # 한 시추공에 완전히 동일한 깊이 구간이 복수 등록되어 있는 건수가 있는지 카운트
        result = await session.execute(text('''
            SELECT b.name, s.depth_top, s.depth_bottom, count(*)
            FROM strata s
            JOIN boreholes b ON s.borehole_id = b.id
            GROUP BY b.name, s.depth_top, s.depth_bottom
            HAVING count(*) > 1
            LIMIT 20
        '''))
        rows = result.all()
        print("\n----- COMPLETELY DUPLICATED STRATA DEPTHS IN DB -----")
        if not rows:
            print("No completely duplicated depth ranges physically found in DB.")
        for row in rows:
            print(f"Borehole: {row[0]} | Range: {row[1]}m ~ {row[2]}m | Count: {row[3]}")

if __name__ == "__main__":
    asyncio.run(main())
    asyncio.run(main2())
