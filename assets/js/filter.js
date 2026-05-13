document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const filter = btn.dataset.filter;

    document.querySelectorAll('.category-group').forEach(group => {
      const match = (filter === 'all' || group.dataset.category === filter);
      group.style.display = match ? 'block' : 'none';
    });
  });
});
