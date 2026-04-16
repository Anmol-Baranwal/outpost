/* global window, document, IntersectionObserver, history */
(function () {
  // ─── Compute base path ──────────────────────────────────────────
  // sidebar.js is loaded from every docs page via ../sidebar.js
  // so "../" always points back to the docs root
  var base = "../";

  // ─── Nav Hierarchy ──────────────────────────────────────────────
  var sections = [
    {
      title: "Getting Started",
      links: [
        { label: "Overview", href: base + "docs/index.html" },
        { label: "Quick Start", href: base + "getting-started/index.html" },
        { label: "Architecture", href: base + "architecture/index.html" },
      ],
    },
    {
      title: "Integrations",
      links: [
        { label: "Discord Bot", href: base + "discord-bot/index.html" },
        { label: "GitHub App", href: base + "github-app/index.html" },
      ],
    },
    {
      title: "Configuration",
      links: [
        { label: "Environment Variables", href: base + "configuration/index.html" },
        { label: "SLA Targets", href: base + "configuration/index.html#sla-targets" },
        { label: "Routing Rules", href: base + "configuration/index.html#routing-rules" },
      ],
    },
    {
      title: "API Reference",
      links: [
        { label: "REST Endpoints", href: base + "api-reference/index.html" },
        { label: "Webhooks", href: base + "api-reference/index.html#webhooks" },
      ],
    },
    {
      title: "Operations",
      links: [
        { label: "Deployment Guide", href: base + "deployment/index.html" },
        { label: "Contributing", href: base + "contributing/index.html" },
      ],
    },
  ];

  // ─── Detect current page ────────────────────────────────────────
  var p = window.location.pathname
    .replace(/\/index\.html$/, "")
    .replace(/\/$/, "");
  var currentPage = p.substring(p.lastIndexOf("/") + 1) || "docs";

  // ─── Build Sidebar HTML ─────────────────────────────────────────
  function buildSidebar() {
    var html = "";
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      html += '<div class="sidebar-section">';
      html += "<h3>" + section.title + "</h3>";
      for (var j = 0; j < section.links.length; j++) {
        var link = section.links[j];
        // Extract directory name from href for matching
        var hrefPath = link.href.replace(/#.*$/, "").replace(/\/$/, "");
        var hrefSegment = hrefPath.substring(hrefPath.lastIndexOf("/") + 1);
        var isActive = hrefSegment === currentPage && link.href.indexOf("#") === -1;
        var activeClass = isActive ? ' class="active"' : "";
        html +=
          '<a href="' +
          link.href +
          '"' +
          activeClass +
          ">" +
          link.label +
          "</a>";
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

    // Ensure each heading has an id for anchor links
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

    // Build TOC HTML
    var html = '<div class="page-toc-label">On this page</div>';
    for (var j = 0; j < headings.length; j++) {
      var heading = headings[j];
      var cls = heading.tagName === "H3" ? ' class="toc-h3"' : "";
      html +=
        '<a href="#' +
        heading.id +
        '"' +
        cls +
        ">" +
        heading.textContent +
        "</a>";
    }
    tocEl.innerHTML = html;

    // Active state tracking with IntersectionObserver
    var tocLinks = tocEl.querySelectorAll('a[href^="#"]');
    var headingEls = [];
    for (var k = 0; k < tocLinks.length; k++) {
      var target = document.getElementById(
        tocLinks[k].getAttribute("href").slice(1),
      );
      if (target) headingEls.push(target);
    }

    if (!headingEls.length || typeof IntersectionObserver === "undefined")
      return;

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

    for (var q = 0; q < headingEls.length; q++) {
      observer.observe(headingEls[q]);
    }

    // Set initial active state
    setActive(0);

    // Smooth scroll on click
    for (var r = 0; r < tocLinks.length; r++) {
      tocLinks[r].addEventListener("click", function (e) {
        e.preventDefault();
        var targetEl = document.getElementById(
          this.getAttribute("href").slice(1),
        );
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
          history.pushState(null, "", this.getAttribute("href"));
        }
      });
    }
  }

  buildPageToc();
})();
