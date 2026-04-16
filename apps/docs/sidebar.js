/* global window, document, IntersectionObserver, history */
(function () {
  // ─── Compute relative base path from current page ───────────────
  // sidebar.js lives at the docs root; pages are one level deep
  // e.g. from docs/index.html the base is "../", from getting-started/index.html it's "../"
  var base = "../";

  // ─── Nav Hierarchy (paths relative from a subdirectory) ─────────
  var sections = [
    {
      title: "Getting Started",
      links: [
        { label: "Overview", href: base + "docs/" },
        { label: "Quick Start", href: base + "getting-started/" },
        { label: "Architecture", href: base + "architecture/" },
      ],
    },
    {
      title: "Integrations",
      links: [
        { label: "Discord Bot", href: base + "discord-bot/" },
        { label: "GitHub App", href: base + "github-app/" },
      ],
    },
    {
      title: "Configuration",
      links: [
        { label: "Environment Variables", href: base + "configuration/" },
        { label: "SLA Targets", href: base + "configuration/#sla-targets" },
        { label: "Routing Rules", href: base + "configuration/#routing-rules" },
      ],
    },
    {
      title: "API Reference",
      links: [
        { label: "REST Endpoints", href: base + "api-reference/" },
        { label: "Webhooks", href: base + "api-reference/#webhooks" },
      ],
    },
    {
      title: "Operations",
      links: [
        { label: "Deployment Guide", href: base + "deployment/" },
        { label: "Contributing", href: base + "contributing/" },
      ],
    },
  ];

  // ─── Detect current page ────────────────────────────────────────
  // Normalize: strip trailing index.html and trailing slash, then take the last path segment
  var loc = window.location.pathname.replace(/\/index\.html$/, "").replace(/\/$/, "");
  var currentSegment = loc.substring(loc.lastIndexOf("/") + 1);
  // Map segment to the canonical href suffix for matching
  var currentPage = currentSegment ? currentSegment : "docs";

  // ─── Build Sidebar HTML ─────────────────────────────────────────
  function buildSidebar() {
    var html = "";
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      html += '<div class="sidebar-section">';
      html += "<h3>" + section.title + "</h3>";
      for (var j = 0; j < section.links.length; j++) {
        var link = section.links[j];
        var href = link.href;
        // Extract the page segment from href for comparison (e.g. "../docs/" -> "docs")
        var hrefSegment = href.replace(/.*\/([^\/]+)\/$/, "$1").replace(/#.*$/, "");
        var isActive = hrefSegment === currentPage && href.indexOf("#") === -1;
        var activeClass = isActive ? ' class="active"' : "";
        html += '<a href="' + href + '"' + activeClass + ">" + link.label + "</a>";
      }
      html += "</div>";
    }
    return html;
  }

  // ─── Inject into DOM ────────────────────────────────────────────
  var sidebarEl = document.getElementById("sidebar");
  if (sidebarEl) {
    sidebarEl.innerHTML = buildSidebar();
    var active = sidebarEl.querySelector(".active");
    if (active) active.scrollIntoView({ block: "center" });
  }

  // ─── Page TOC (right sidebar) ──────────────────────────────────
  function buildPageToc() {
    var tocEl = document.getElementById("page-toc");
    if (!tocEl) return;

    var content = document.querySelector(".docs-content");
    if (!content) return;

    var headings = content.querySelectorAll("h2, h3");
    if (headings.length < 3) return;

    for (var i = 0; i < headings.length; i++) {
      var h = headings[i];
      if (!h.id) {
        h.id = h.textContent
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");
      }
    }

    var html = '<div class="page-toc-label">On this page</div>';
    for (var j = 0; j < headings.length; j++) {
      var heading = headings[j];
      var cls = heading.tagName === "H3" ? ' class="toc-h3"' : "";
      html += '<a href="#' + heading.id + '"' + cls + ">" + heading.textContent + "</a>";
    }
    tocEl.innerHTML = html;

    var tocLinks = tocEl.querySelectorAll('a[href^="#"]');
    var headingEls = [];
    for (var k = 0; k < tocLinks.length; k++) {
      var target = document.getElementById(tocLinks[k].getAttribute("href").slice(1));
      if (target) headingEls.push(target);
    }

    if (!headingEls.length || typeof IntersectionObserver === "undefined") return;

    function setActive(index) {
      for (var m = 0; m < tocLinks.length; m++) {
        tocLinks[m].classList.remove("active");
      }
      if (tocLinks[index]) {
        tocLinks[index].classList.add("active");
      }
    }

    var observer = new IntersectionObserver(
      function (entries) {
        var topmostIndex = -1;
        for (var n = 0; n < entries.length; n++) {
          if (entries[n].isIntersecting) {
            var idx = headingEls.indexOf(entries[n].target);
            if (idx !== -1 && (topmostIndex === -1 || idx < topmostIndex)) {
              topmostIndex = idx;
            }
          }
        }
        if (topmostIndex !== -1) {
          setActive(topmostIndex);
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 },
    );

    for (var p = 0; p < headingEls.length; p++) {
      observer.observe(headingEls[p]);
    }

    setActive(0);

    for (var q = 0; q < tocLinks.length; q++) {
      tocLinks[q].addEventListener("click", function (e) {
        e.preventDefault();
        var targetEl = document.getElementById(this.getAttribute("href").slice(1));
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
          history.pushState(null, "", this.getAttribute("href"));
        }
      });
    }
  }

  buildPageToc();
})();
