export default function Members({ members }) {
  return (
    <div className="members">
      <h2 className="section-title">
        Members ({members.length})
      </h2>

      <div className="members-list">
        {members.map((member) => (
          <div key={member.user_id} className="member-item">
            <div className="member-avatar">
              {member.display_name.charAt(0).toUpperCase()}
            </div>
            
            <div className="member-info">
              <div className="member-name">
                {member.display_name}
                {member.is_host && (
                  <span className="host-badge">HOST</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
