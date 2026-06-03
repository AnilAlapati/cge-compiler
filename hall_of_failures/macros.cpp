#define DECLARE_PROPERTY(Type, Name) \
private: \
    Type m_##Name; \
public: \
    Type get##Name() const { return m_##Name; } \
    void set##Name(const Type& val) { m_##Name = val; }

class UserSession {
    DECLARE_PROPERTY(int, SessionId)
    DECLARE_PROPERTY(std::string, Token)

public:
    bool IsValid() const {
        return m_SessionId > 0 && !m_Token.empty();
    }
};
