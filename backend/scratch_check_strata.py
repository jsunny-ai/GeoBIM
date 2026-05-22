import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

async def main():
    engine = create_async_engine('postgresql+asyncpg://geobim:geobim_dev_only@127.0.0.1:5432/geobim')
    async_session = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    
    async with async_session() as session:
        result = await session.execute(text('''
            SELECT b.id, count(s.id) 
            FROM boreholes b 
            LEFT JOIN strata s ON b.id = s.borehole_id 
            WHERE b.id >= 3300 AND b.id <= 3400 
            GROUP BY b.id 
            HAVING count(s.id) = 0
        '''))
        missing = [row[0] for row in result.all()]
        print(f'Boreholes with 0 strata (3300-3400): {missing}')

asyncio.run(main())
