const nav = document.getElementById("nav");

if (nav) {
  let isScrolled;
  let updatePending = false;

  const updateNav = () => {
    const nextScrolled = window.scrollY > 18;

    if (nextScrolled !== isScrolled) {
      nav.classList.toggle("scrolled", nextScrolled);
      nav.classList.toggle("at-top", !nextScrolled);
      isScrolled = nextScrolled;
    }

    updatePending = false;
  };

  const queueNavUpdate = () => {
    if (!updatePending) {
      updatePending = true;
      window.requestAnimationFrame(updateNav);
    }
  };

  updateNav();
  window.addEventListener("scroll", queueNavUpdate, { passive: true });
}
