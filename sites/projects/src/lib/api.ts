import axios from "axios"

export const api = axios.create({
  baseURL: "http://localhost:8000/api/v1",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
  timeout: 3000,
})

// 401 → auth 사이트로 리다이렉트
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      window.location.href = "http://localhost:5170/"
    }
    return Promise.reject(err)
  },
)
