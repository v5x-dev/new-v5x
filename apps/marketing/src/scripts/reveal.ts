const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue

      entry.target.classList.add("is-visible")
      observer.unobserve(entry.target)
    }
  },
  { rootMargin: "0px 0px -4% 0px", threshold: 0 }
)

for (const element of document.querySelectorAll("[data-reveal]")) {
  observer.observe(element)
}
