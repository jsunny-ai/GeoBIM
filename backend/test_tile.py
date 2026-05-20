import requests

url = "http://localhost:8000/api/v1/tiles/vworld/Satellite/14/13931/6335"
response = requests.get(url)

print(f"Status Code: {response.status_code}")
print(f"Headers: {response.headers}")
with open("tile.jpg", "wb") as f:
    f.write(response.content)

print(f"Content length: len({response.content})")
if len(response.content) > 100:
    print(f"First 50 bytes: {response.content[:50]}")
